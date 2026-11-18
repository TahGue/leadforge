/**
 * company_normalization stage (spec section 9, stages 5-7).
 *
 * Turns one CompanyCandidate (a raw source record) into a deduplicated Company
 * with provenance, or rejects it with a reason. Rules:
 *  - merge automatically only on registrable domain or registration number;
 *  - a name+country match creates a duplicate candidate for human review;
 *  - existing values are never overwritten by a new source, only filled in;
 *  - every field taken from the source is recorded as a SourceObservation.
 */
import { createHash } from "node:crypto";
import { Prisma, prisma, type CompanyCandidate } from "@leadforge/database";
import {
  discoveryProjectSettings,
  domainSuppressionKey,
  normalizeCompanyName,
  normalizeName,
  normalizeRegistrationNumber,
  registrableDomain,
  topLevelDomain,
  type DiscoveryProjectSettings,
} from "@leadforge/shared";
import { inScope, loadProjectScope, resolveLocation, type ProjectScope, type ResolvedLocation } from "./geo";
import { classify, industryAllowed, loadIndustryScope, type IndustryMatch, type IndustryScope } from "./taxonomy";
import { companyScore } from "./scoring";

type Tx = Prisma.TransactionClient;

export interface ProjectContext {
  projectId: string;
  organizationId: string;
  status: string;
  maxCompanies: number;
  maxPagesPerCompany: number;
  maxCrawlDepth: number;
  settings: DiscoveryProjectSettings;
  scope: ProjectScope;
  industries: IndustryScope;
  includeKeywords: string[];
  excludeKeywords: string[];
}

export async function loadProjectContext(projectId: string): Promise<ProjectContext> {
  const project = await prisma.discoveryProject.findUniqueOrThrow({
    where: { id: projectId },
    include: { keywords: true },
  });
  const settings = discoveryProjectSettings.parse(project.settings ?? {});
  return {
    projectId,
    organizationId: project.organizationId,
    status: project.status,
    maxCompanies: project.maxCompanies,
    maxPagesPerCompany: project.maxPagesPerCompany,
    maxCrawlDepth: project.maxCrawlDepth,
    settings,
    scope: await loadProjectScope(prisma, projectId),
    industries: await loadIndustryScope(prisma, projectId),
    includeKeywords: project.keywords
      .filter((k) => k.mode === "INCLUDE" && k.keywordType !== "DOMAIN")
      .map((k) => normalizeName(k.keyword))
      .filter(Boolean),
    excludeKeywords: [
      ...project.keywords.filter((k) => k.mode === "EXCLUDE").map((k) => normalizeName(k.keyword)),
      ...settings.exclusions.keywords.map((k) => normalizeName(k)),
    ].filter(Boolean),
  };
}

export type NormalizationResult =
  | { status: "CREATED" | "MERGED"; companyId: string; crawlJobId: string | null; duplicateOf: string | null }
  | { status: "REJECTED"; reason: string };

function containsTerm(text: string, term: string): boolean {
  return ` ${text} `.includes(` ${term} `);
}

/** Pure filter checks that need no database access. Exported for unit tests. */
export function precheck(
  candidate: Pick<
    CompanyCandidate,
    "name" | "website" | "description" | "industryLabel" | "foundedYear" | "employeeRange" | "legalForm"
  >,
  ctx: Pick<ProjectContext, "settings" | "includeKeywords" | "excludeKeywords">,
  userSupplied: boolean,
): { ok: true; domain: string | null } | { ok: false; reason: string } {
  if (!candidate.name?.trim()) return { ok: false, reason: "missing_name" };
  const domain = candidate.website ? registrableDomain(candidate.website) : null;
  const { company, exclusions, website } = ctx.settings;

  if (company.domainRequired && !domain) return { ok: false, reason: "no_domain" };
  if (website.presence === "EXISTS" && !domain) return { ok: false, reason: "no_website" };
  if (website.presence === "ABSENT" && domain) return { ok: false, reason: "has_website" };
  if (domain && exclusions.domains.some((d) => registrableDomain(d) === domain)) {
    return { ok: false, reason: "excluded_domain" };
  }
  if (company.httpsRequired && candidate.website && candidate.website.startsWith("http://")) {
    return { ok: false, reason: "https_required" };
  }

  const text = normalizeName(`${candidate.name} ${candidate.description ?? ""} ${candidate.industryLabel ?? ""}`);
  if (ctx.excludeKeywords.some((k) => containsTerm(text, k))) return { ok: false, reason: "excluded_keyword" };
  if (!userSupplied && ctx.includeKeywords.length && !ctx.includeKeywords.some((k) => containsTerm(text, k))) {
    return { ok: false, reason: "keyword_mismatch" };
  }
  if (company.descriptionRequired && !candidate.description) return { ok: false, reason: "no_description" };
  if (candidate.foundedYear) {
    if (company.foundedFrom && candidate.foundedYear < company.foundedFrom) return { ok: false, reason: "founded_before_range" };
    if (company.foundedTo && candidate.foundedYear > company.foundedTo) return { ok: false, reason: "founded_after_range" };
  }
  if (company.employeeRanges.length && candidate.employeeRange && !company.employeeRanges.includes(candidate.employeeRange)) {
    return { ok: false, reason: "employee_range_mismatch" };
  }
  if (
    company.legalForms.length &&
    candidate.legalForm &&
    !company.legalForms.map(normalizeName).includes(normalizeName(candidate.legalForm))
  ) {
    return { ok: false, reason: "legal_form_mismatch" };
  }
  return { ok: true, domain };
}

async function suppressedDomain(tx: Tx, domain: string): Promise<boolean> {
  const hit = await tx.suppressionEntry.findFirst({
    where: { emailNormalized: domainSuppressionKey(domain), liftedAt: null },
    select: { id: true },
  });
  return Boolean(hit);
}

async function findExisting(
  tx: Tx,
  organizationId: string,
  domain: string | null,
  registrationNumber: string | null,
  countryIso2: string | null,
) {
  if (domain) {
    const link = await tx.companyDomain.findFirst({
      where: { domain: { registrableDomain: domain }, company: { organizationId, deletedAt: null } },
      select: { companyId: true },
    });
    if (link) return { companyId: link.companyId, signal: "domain" as const };
  }
  if (registrationNumber) {
    const company = await tx.company.findFirst({
      where: { organizationId, registrationNumber, deletedAt: null, ...(countryIso2 ? { countryCode: countryIso2 } : {}) },
      select: { id: true },
    });
    if (company) return { companyId: company.id, signal: "registration_number" as const };
  }
  return null;
}

async function upsertDomain(tx: Tx, domain: string) {
  return tx.domain.upsert({
    where: { domain },
    create: { domain, registrableDomain: domain, tld: topLevelDomain(domain), nextCrawlAt: new Date() },
    update: {},
  });
}

export async function createCrawlJob(
  tx: Tx,
  input: {
    organizationId: string;
    projectId: string | null;
    companyId: string;
    domainId: string;
    domain: string;
    sourceId: string | null;
    maxPages: number;
    maxDepth: number;
    priority?: number;
  },
): Promise<string | null> {
  const rootUrl = `https://${input.domain}/`;
  const urlHash = createHash("sha256").update(`${input.projectId ?? "adhoc"}|${rootUrl}`).digest("hex");
  const existing = await tx.crawlJob.findFirst({
    where: { projectId: input.projectId, urlHash },
    select: { id: true },
  });
  if (existing) return existing.id;
  const job = await tx.crawlJob.create({
    data: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      companyId: input.companyId,
      domainId: input.domainId,
      sourceId: input.sourceId,
      rootUrl,
      urlHash,
      maxPages: input.maxPages,
      maxDepth: input.maxDepth,
      priority: input.priority ?? 100,
    },
    select: { id: true },
  });
  return job.id;
}

async function recordObservations(
  tx: Tx,
  candidate: CompanyCandidate,
  companyId: string,
  policyVersion: number,
  fields: Record<string, string | number | null | undefined>,
) {
  const rows = Object.entries(fields)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    .map(([fieldName, value]) => ({
      organizationId: candidate.organizationId,
      sourceId: candidate.sourceId,
      companyId,
      discoveryRunId: candidate.runId,
      sourceRecordId: candidate.sourceRecordId,
      fieldName,
      fieldValue: String(value),
      sourceUrl: candidate.sourceUrl,
      licence: candidate.licence,
      policyVersion,
      confidence: 0.8,
    }));
  if (rows.length) await tx.sourceObservation.createMany({ data: rows });
}

async function addLocation(tx: Tx, companyId: string, candidate: CompanyCandidate, place: ResolvedLocation) {
  const rawText = [candidate.addressLine, candidate.postalCode, candidate.cityName, candidate.regionName]
    .filter(Boolean)
    .join(", ");
  if (!place.countryIso2 && !rawText && place.latitude === null) return;
  const duplicate = await tx.companyLocation.findFirst({
    where: { companyId, cityId: place.cityId, countryIso2: place.countryIso2, addressLine: candidate.addressLine },
    select: { id: true },
  });
  if (duplicate) return;
  const isHeadquarters = (candidate.raw as Record<string, unknown> | null)?.["locationType"] === "HEADQUARTERS";
  await tx.companyLocation.create({
    data: {
      companyId,
      locationType: isHeadquarters ? "HEADQUARTERS" : "UNKNOWN",
      isHeadquarters,
      addressLine: candidate.addressLine,
      postalCode: candidate.postalCode,
      rawText: rawText || null,
      countryIso2: place.countryIso2,
      regionId: place.regionId,
      cityId: place.cityId,
      latitude: place.latitude,
      longitude: place.longitude,
      sourceId: candidate.sourceId,
      confidence: place.confidence,
      resolution: place.resolution,
    },
  });
}

async function addIndustries(tx: Tx, companyId: string, matches: IndustryMatch[], sourceId: string) {
  const hasPrimary = await tx.companyIndustry.findFirst({ where: { companyId, isPrimary: true }, select: { id: true } });
  let primaryAssigned = Boolean(hasPrimary);
  for (const match of matches) {
    await tx.companyIndustry.upsert({
      where: { companyId_industryId: { companyId, industryId: match.industryId } },
      create: {
        companyId,
        industryId: match.industryId,
        isPrimary: !primaryAssigned,
        confidence: match.confidence,
        method: match.method,
        sourceId,
        evidence: match.evidence,
      },
      update: {},
    });
    primaryAssigned = true;
  }
}

export async function processCandidate(candidateId: string, contextCache?: Map<string, ProjectContext>): Promise<NormalizationResult> {
  const candidate = await prisma.companyCandidate.findUnique({ where: { id: candidateId } });
  if (!candidate) return { status: "REJECTED", reason: "missing_candidate" };
  if (candidate.status !== "PENDING") {
    return candidate.companyId && candidate.status !== "REJECTED"
      ? { status: candidate.status as "CREATED" | "MERGED", companyId: candidate.companyId, crawlJobId: null, duplicateOf: null }
      : { status: "REJECTED", reason: candidate.rejectReason ?? "already_processed" };
  }

  let ctx = contextCache?.get(candidate.projectId);
  if (!ctx) {
    ctx = await loadProjectContext(candidate.projectId);
    contextCache?.set(candidate.projectId, ctx);
  }

  const reject = async (reason: string): Promise<NormalizationResult> => {
    await prisma.companyCandidate.update({
      where: { id: candidate.id },
      data: { status: "REJECTED", rejectReason: reason, processedAt: new Date() },
    });
    return { status: "REJECTED", reason };
  };

  if (ctx.status === "CANCELLED") return reject("project_cancelled");

  const source = await prisma.source.findUnique({ where: { id: candidate.sourceId } });
  if (!source) return reject("source_missing");
  const userSupplied = source.adapter === "domain_list" || source.sourceType === "IMPORT";

  const pre = precheck(candidate, ctx, userSupplied);
  if (!pre.ok) return reject(pre.reason);
  const domain = pre.domain;

  const place = await resolveLocation(prisma, {
    countryIso2: candidate.countryIso2,
    regionName: candidate.regionName,
    cityName: candidate.cityName,
    postalCode: candidate.postalCode,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
  });
  const geography = inScope(ctx.scope, place);
  if (geography === false) return reject("outside_geography");
  if (geography === null && !userSupplied) return reject("location_unknown");
  if (place.confidence < ctx.settings.minLocationConfidence && !userSupplied) return reject("location_low_confidence");

  const matches = await classify({
    codes: (candidate.industryCodes as { scheme: string; code: string }[] | null) ?? [],
    label: candidate.industryLabel,
    text: candidate.description,
  });
  if (industryAllowed(ctx.industries, matches) === false) return reject("industry_mismatch");

  const registrationNumber = normalizeRegistrationNumber(candidate.registrationNumber);

  const result = await prisma.$transaction(
    async (tx): Promise<NormalizationResult> => {
      if (domain && ctx!.settings.exclusions.excludeSuppressed && (await suppressedDomain(tx, domain))) {
        return { status: "REJECTED", reason: "suppressed_domain" };
      }

      const existing = await findExisting(tx, ctx!.organizationId, domain, registrationNumber, place.countryIso2);

      if (existing) {
        const company = await tx.company.findUniqueOrThrow({
          where: { id: existing.companyId },
          select: { id: true, tags: true, lastCrawledAt: true, projects: { select: { projectId: true } } },
        });
        if (ctx!.settings.exclusions.tags.some((t) => company.tags.includes(t))) {
          return { status: "REJECTED", reason: "excluded_tag" };
        }
        if (
          ctx!.settings.exclusions.excludePreviouslyProcessed &&
          company.projects.some((p) => p.projectId !== ctx!.projectId)
        ) {
          return { status: "REJECTED", reason: "previously_processed" };
        }
      }

      const inProject = await tx.projectCompany.count({ where: { projectId: ctx!.projectId } });
      const alreadyLinked = existing
        ? await tx.projectCompany.findUnique({
            where: { projectId_companyId: { projectId: ctx!.projectId, companyId: existing.companyId } },
          })
        : null;
      if (!alreadyLinked && inProject >= ctx!.maxCompanies) return { status: "REJECTED", reason: "project_cap_reached" };

      const normalizedName = normalizeCompanyName(candidate.name);
      let companyId: string;
      let duplicateOf: string | null = null;
      let status: "CREATED" | "MERGED";

      if (existing) {
        status = "MERGED";
        companyId = existing.companyId;
        const current = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
        // Fill gaps only; never overwrite an existing value with a new source's value.
        await tx.company.update({
          where: { id: companyId },
          data: {
            lastSeenAt: new Date(),
            legalName: current.legalName ?? candidate.name,
            description: current.description ?? candidate.description,
            countryCode: current.countryCode ?? place.countryIso2,
            registrationNumber: current.registrationNumber ?? registrationNumber,
            legalForm: current.legalForm ?? candidate.legalForm,
            employeeRange: current.employeeRange ?? candidate.employeeRange,
            foundedYear: current.foundedYear ?? candidate.foundedYear,
            industryLabel: current.industryLabel ?? candidate.industryLabel,
            website: current.website ?? (domain ? candidate.website : null),
          },
        });
      } else {
        status = "CREATED";
        const sameName = await tx.company.findFirst({
          where: {
            organizationId: ctx!.organizationId,
            normalizedName,
            deletedAt: null,
            ...(place.countryIso2 ? { countryCode: place.countryIso2 } : {}),
          },
          select: { id: true },
        });
        const created = await tx.company.create({
          data: {
            organizationId: ctx!.organizationId,
            name: candidate.name.trim(),
            normalizedName,
            description: candidate.description,
            countryCode: place.countryIso2,
            industryLabel: candidate.industryLabel,
            registrationNumber,
            legalForm: candidate.legalForm,
            employeeRange: candidate.employeeRange,
            foundedYear: candidate.foundedYear,
            website: domain ? (candidate.website ?? `https://${domain}`) : null,
            websiteStatus: domain ? "UNKNOWN" : "ABSENT",
            reviewStatus: matches.length === 0 || place.resolution !== "RESOLVED" || sameName ? "NEEDS_REVIEW" : "UNREVIEWED",
          },
          select: { id: true },
        });
        companyId = created.id;
        if (sameName) {
          duplicateOf = sameName.id;
          const [a, b] = [sameName.id, companyId].sort();
          await tx.companyDuplicateCandidate.upsert({
            where: { companyAId_companyBId: { companyAId: a!, companyBId: b! } },
            create: {
              organizationId: ctx!.organizationId,
              companyAId: a!,
              companyBId: b!,
              score: 0.6,
              signals: [{ signal: "normalized_name", value: normalizedName }, { signal: "country", value: place.countryIso2 }],
            },
            update: {},
          });
        }
      }

      let domainId: string | null = null;
      if (domain) {
        const domainRow = await upsertDomain(tx, domain);
        domainId = domainRow.id;
        const link = await tx.companyDomain.findUnique({ where: { domainId: domainRow.id } });
        if (!link) {
          await tx.companyDomain.create({
            data: { companyId, domainId: domainRow.id, isPrimary: !existing, verifiedAt: null },
          });
        }
        await tx.sourceEvidence.create({
          data: {
            organizationId: ctx!.organizationId,
            companyId,
            domainId: domainRow.id,
            sourceId: candidate.sourceId,
            pageUrl: candidate.sourceUrl ?? candidate.website ?? `https://${domain}/`,
            fieldName: "domain",
            extractedValue: domain,
            method: userSupplied ? "import" : "source",
            extractorVersion: `source:${source.adapter ?? source.sourceType}`,
          },
        });
      }

      await recordObservations(tx, candidate, companyId, source.policyVersion, {
        name: candidate.name,
        website: candidate.website,
        registration_number: candidate.registrationNumber,
        legal_form: candidate.legalForm,
        description: candidate.description,
        country: candidate.countryIso2,
        region: candidate.regionName,
        city: candidate.cityName,
        postal_code: candidate.postalCode,
        address: candidate.addressLine,
        phone: candidate.phone,
        industry_label: candidate.industryLabel,
        employee_range: candidate.employeeRange,
        founded_year: candidate.foundedYear,
      });
      await addLocation(tx, companyId, candidate, place);
      await addIndustries(tx, companyId, matches, candidate.sourceId);

      await tx.projectCompany.upsert({
        where: { projectId_companyId: { projectId: ctx!.projectId, companyId } },
        create: {
          projectId: ctx!.projectId,
          companyId,
          discoveredVia: existing ? "EXISTING" : userSupplied ? "IMPORT" : "SOURCE",
          sourceId: candidate.sourceId,
        },
        update: {},
      });

      // Score from what we know now; the crawler refines it.
      const sources = await tx.sourceObservation.findMany({
        where: { companyId },
        distinct: ["sourceId"],
        select: { sourceId: true },
      });
      const score = companyScore({
        hasOfficialWebsite: Boolean(domain),
        independentSources: sources.length,
        sourceType: source.sourceType,
        locationConfidence: place.confidence,
        industryConfidence: matches[0]?.confidence ?? 0,
        observedAt: new Date(),
        reviewed: false,
      });
      await tx.company.update({
        where: { id: companyId },
        data: { confidence: score.score, confidenceDetail: score as unknown as Prisma.InputJsonValue },
      });

      let crawlJobId: string | null = null;
      if (domain && domainId) {
        const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { lastCrawledAt: true } });
        const freshUntil = company.lastCrawledAt
          ? company.lastCrawledAt.getTime() + ctx!.settings.crawl.freshnessDays * 86_400_000
          : 0;
        if (freshUntil < Date.now()) {
          crawlJobId = await createCrawlJob(tx, {
            organizationId: ctx!.organizationId,
            projectId: ctx!.projectId,
            companyId,
            domainId,
            domain,
            sourceId: candidate.sourceId,
            maxPages: ctx!.maxPagesPerCompany,
            maxDepth: ctx!.maxCrawlDepth,
          });
        }
      }

      await tx.companyCandidate.update({
        where: { id: candidate.id },
        data: { status, companyId, processedAt: new Date() },
      });
      return { status, companyId, crawlJobId, duplicateOf };
    },
    { timeout: 30_000 },
  );

  if (result.status === "REJECTED") await reject(result.reason);
  return result;
}

/** Process pending candidates in arrival order. Returns how many were handled. */
export async function processPendingCandidates(limit = 200, projectId?: string): Promise<number> {
  const pending = await prisma.companyCandidate.findMany({
    where: {
      status: "PENDING",
      ...(projectId ? { projectId } : {}),
      // Never normalize for a paused project: pause must stop new work.
      // (Cancelled projects are drained to REJECTED.)
    },
    select: { id: true, projectId: true },
    orderBy: [{ createdAt: "asc" }, { sourceRecordId: "asc" }],
    take: limit,
  });
  if (!pending.length) return 0;
  const projects = await prisma.discoveryProject.findMany({
    where: { id: { in: [...new Set(pending.map((p) => p.projectId))] } },
    select: { id: true, status: true },
  });
  const active = new Set(projects.filter((p) => p.status === "RUNNING" || p.status === "CANCELLED").map((p) => p.id));
  const cache = new Map<string, ProjectContext>();
  let handled = 0;
  for (const row of pending) {
    if (!active.has(row.projectId)) continue;
    try {
      await processCandidate(row.id, cache);
    } catch (error) {
      console.error("normalization_failed", row.id, (error as Error).message);
      await prisma.companyCandidate.update({
        where: { id: row.id },
        data: { status: "REJECTED", rejectReason: `error: ${(error as Error).message.slice(0, 200)}`, processedAt: new Date() },
      });
    }
    handled += 1;
  }
  return handled;
}
