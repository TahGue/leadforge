/**
 * Company and contact search (spec sections 16 and 21). Full-text search uses
 * the generated "searchVector" column (Postgres FTS, ADR-0015); structured
 * filters use indexed columns. All queries are tenant-scoped.
 */
import { Prisma, prisma } from "@leadforge/database";
import type { z } from "zod";
import { discoveryProjectSettings, type companyListQuery, type contactListQuery } from "@leadforge/shared";
import { descendants, loadTaxonomy } from "./taxonomy";
import { limits } from "./config";

export async function fullTextCompanyIds(organizationId: string, q: string, limit = 2000): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Company"
    WHERE "organizationId" = ${organizationId} AND "deletedAt" IS NULL
      AND ("searchVector" @@ websearch_to_tsquery('simple', ${q})
           OR "normalizedName" LIKE ${"%" + q.toLowerCase() + "%"})
    ORDER BY ts_rank("searchVector", websearch_to_tsquery('simple', ${q})) DESC
    LIMIT ${limit}`;
  return rows.map((r) => r.id);
}

export async function companyWhere(
  organizationId: string,
  query: z.infer<typeof companyListQuery>,
): Promise<Prisma.CompanyWhereInput> {
  const and: Prisma.CompanyWhereInput[] = [];
  if (query.q) {
    const ids = await fullTextCompanyIds(organizationId, query.q);
    and.push({
      OR: [
        { id: { in: ids } },
        { domains: { some: { domain: { domain: { contains: query.q.toLowerCase() } } } } },
      ],
    });
  }
  if (query.country) and.push({ countryCode: query.country });
  if (query.regionId) and.push({ locations: { some: { regionId: query.regionId } } });
  if (query.cityId) and.push({ locations: { some: { cityId: query.cityId } } });
  if (query.industryId) {
    const index = await loadTaxonomy();
    and.push({ industries: { some: { industryId: { in: [...descendants(index, [query.industryId])] } } } });
  }
  if (query.projectId) and.push({ projects: { some: { projectId: query.projectId } } });
  if (query.tag) and.push({ tags: { has: query.tag } });
  if (query.reviewStatus) and.push({ reviewStatus: query.reviewStatus });
  if (query.minConfidence !== undefined) and.push({ confidence: { gte: query.minConfidence } });
  if (query.hasContacts === "true") and.push({ contacts: { some: { deletedAt: null } } });
  if (query.hasContacts === "false") and.push({ contacts: { none: { deletedAt: null } } });
  if (query.stale === "true") {
    and.push({ lastSeenAt: { lt: new Date(Date.now() - limits.companyFreshnessDays * 86_400_000) } });
  }
  return { organizationId, deletedAt: null, AND: and };
}

export function contactWhere(
  organizationId: string,
  query: z.infer<typeof contactListQuery>,
): Prisma.ContactWhereInput {
  const and: Prisma.ContactWhereInput[] = [];
  if (query.q) {
    const q = query.q;
    and.push({
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { jobTitle: { contains: q, mode: "insensitive" } },
        { emails: { some: { email: { normalized: { contains: q.toLowerCase() } } } } },
        { company: { name: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  if (query.companyId) and.push({ companyId: query.companyId });
  if (query.projectId) and.push({ company: { projects: { some: { projectId: query.projectId } } } });
  if (query.category) and.push({ category: query.category });
  if (query.emailStatus) {
    and.push({ emails: { some: { email: { status: query.emailStatus as Prisma.EnumEmailStatusFilter["equals"] } } } });
  }
  if (query.hasPhone === "true") and.push({ phoneE164: { not: null } });
  if (query.hasPhone === "false") and.push({ phoneE164: null });
  if (query.country) and.push({ company: { countryCode: query.country } });
  if (query.minConfidence !== undefined) and.push({ confidence: { gte: query.minConfidence } });
  return { organizationId, deletedAt: null, AND: and };
}

/**
 * Filters from the project settings that can only be decided after crawling
 * (website, contact and quality filters). Applied to project results so the
 * "strict" view shows only records meeting every requirement.
 */
export async function projectResultWhere(projectId: string): Promise<Prisma.CompanyWhereInput> {
  const project = await prisma.discoveryProject.findUniqueOrThrow({
    where: { id: projectId },
    select: { settings: true, minConfidence: true },
  });
  const s = discoveryProjectSettings.parse(project.settings ?? {});
  const and: Prisma.CompanyWhereInput[] = [{ confidence: { gte: project.minConfidence } }];

  if (s.website.requireContactPage) and.push({ hasContactPage: true });
  if (s.website.requireCareersPage) and.push({ hasCareersPage: true });
  if (s.website.requireShop) and.push({ technologies: { array_contains: ["shop"] } });
  for (const tech of s.website.technologies) and.push({ technologies: { array_contains: [tech] } });
  if (s.language.websiteLanguages.length) {
    and.push({
      OR: [
        { primaryLanguage: { in: s.language.websiteLanguages } },
        ...(s.language.allowUnknown ? [{ primaryLanguage: null }] : []),
      ],
    });
  }
  if (s.company.httpsRequired) and.push({ httpsEnabled: true });
  if (s.company.websiteReachability !== "ANY") and.push({ websiteStatus: s.company.websiteReachability });
  if (s.company.socialProfilesRequired) and.push({ NOT: { socialProfiles: { equals: [] } } });
  if (s.company.operatingStatuses.length) and.push({ operatingStatus: { in: s.company.operatingStatuses } });
  if (s.company.ownership.length) and.push({ ownership: { in: s.company.ownership } });
  if (s.quality.requireReviewed) and.push({ reviewStatus: "REVIEWED" });
  if (s.quality.officialWebsiteRequired) and.push({ domains: { some: {} } });
  if (s.quality.maxRecordAgeDays) {
    and.push({ lastSeenAt: { gte: new Date(Date.now() - s.quality.maxRecordAgeDays * 86_400_000) } });
  }
  if (s.quality.excludeDuplicates) {
    and.push({ duplicateA: { none: { status: "OPEN" } }, duplicateB: { none: { status: "OPEN" } } });
  }
  if (s.quality.minSourceObservations > 1) {
    const rows = await prisma.$queryRaw<{ companyId: string }[]>`
      SELECT o."companyId" FROM "SourceObservation" o
      JOIN "ProjectCompany" pc ON pc."companyId" = o."companyId" AND pc."projectId" = ${projectId}
      GROUP BY o."companyId" HAVING COUNT(DISTINCT o."sourceId") >= ${s.quality.minSourceObservations}`;
    and.push({ id: { in: rows.map((r) => r.companyId) } });
  } else if (s.quality.minSourceObservations === 1) {
    and.push({ observations: { some: {} } });
  }

  const c = s.contacts;
  const contact: Prisma.ContactWhereInput = {
    deletedAt: null,
    confidence: { gte: c.minConfidence },
    category: { in: c.categories },
    ...(c.roleMode === "ROLE_ONLY" ? { isRoleBased: true } : c.roleMode === "NAMED_ONLY" ? { isRoleBased: false } : {}),
    ...(c.requireEvidence ? { OR: [{ evidence: { some: {} } }, { sourceUrl: { not: null } }] } : {}),
  };
  const emailFilter: Prisma.EmailAddressWhereInput = {
    ...(c.excludeFreeMail ? { isFreeProvider: false } : {}),
    ...(c.requireMxValid
      ? { status: "MX_VALID" }
      : c.requireSyntaxValid
        ? { status: { notIn: ["UNDELIVERABLE", "SUPPRESSED"] } }
        : { status: { not: "SUPPRESSED" } }),
  };
  const contactRequirements: Prisma.ContactWhereInput[] = [contact];
  if (c.requirePhone) contactRequirements.push({ phoneE164: { not: null } });
  if (c.requireContactForm) contactRequirements.push({ contactFormUrl: { not: null } });
  if (!c.requirePhone && !c.requireContactForm) contactRequirements.push({ emails: { some: { email: emailFilter } } });
  and.push({ contacts: { some: { AND: contactRequirements } } });

  return { AND: and };
}
