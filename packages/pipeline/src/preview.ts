/**
 * Project preview (spec section 5.10). Estimates come from data already in
 * LeadForge; they are not guarantees of what sources will return.
 */
import { prisma } from "@leadforge/database";
import { getProject, requiresApproval, sourceUsable } from "./projects";
import { loadProjectScope, scopeCountries } from "./geo";
import { loadIndustryScope } from "./taxonomy";

export interface Preview {
  scope: { geography: string[]; excludedGeography: string[]; industries: string[]; excludedIndustries: string[]; keywords: string[] };
  sources: { id: string; name: string; adapter: string | null; policyStatus: string; enabled: boolean; usable: boolean; note: string | null }[];
  budget: {
    maxCompanies: number;
    maxPagesPerCompany: number;
    maxCrawlDepth: number;
    maxRequests: number;
    estimatedCrawlHours: number;
  };
  estimates: { knownCompaniesInScope: number; knownCompaniesWithDomain: number; note: string };
  warnings: string[];
  blockers: string[];
  requiresApproval: boolean;
  approved: boolean;
}

export async function previewProject(organizationId: string, projectId: string): Promise<Preview> {
  const project = await getProject(organizationId, projectId);
  const settings = project.settings;
  const scope = await loadProjectScope(prisma, projectId);
  const industries = await loadIndustryScope(prisma, projectId);
  const warnings: string[] = [];
  const blockers: string[] = [];

  const sources = project.sources.map((s) => {
    const usable = s.enabled && sourceUsable(s.source);
    let note: string | null = null;
    if (!s.enabled) note = "Not selected for this run";
    else if (s.source.policyStatus === "DENIED") note = "Policy denied: this source will not be used";
    else if (s.source.policyStatus !== "APPROVED") note = "Policy not approved yet: review terms and licence first";
    else if (!s.source.enabled) note = "Source disabled in the registry";
    else if (!s.source.permitted) note = "Automated access not permitted";
    return {
      id: s.sourceId,
      name: s.source.name,
      adapter: s.source.adapter,
      policyStatus: s.source.policyStatus,
      enabled: s.enabled,
      usable,
      note,
    };
  });
  if (!sources.length) blockers.push("No source selected.");
  else if (!sources.some((s) => s.usable)) blockers.push("No selected source has an approved, enabled policy.");
  for (const s of sources) if (s.enabled && !s.usable && s.note) warnings.push(`${s.name}: ${s.note}`);

  if (scope.worldwide) {
    warnings.push("Worldwide scope: results depend entirely on the sources' own coverage.");
  }
  const countries = await scopeCountries(prisma, scope);

  const needsApproval = requiresApproval(project);
  if (needsApproval && !project.approvedAt) blockers.push("High-volume project: an admin must approve it before it starts.");

  const c = settings.company;
  if (c.revenueRanges.length) warnings.push("Revenue filters only match companies whose sources state revenue; most will be excluded.");
  if (c.employeeRanges.length) warnings.push("Employee filters apply only where a source states headcount.");
  if (c.ownership.length) warnings.push("Ownership filters (subsidiary/franchise) need explicit evidence and reduce coverage.");
  if (c.domainRequired) warnings.push("Companies without a known website are skipped (domain required).");
  if (settings.contacts.roleMode === "NAMED_ONLY") warnings.push("Named contacts are rare on company websites; expect low yield.");
  if (settings.contacts.requireMxValid) warnings.push("Requiring MX-valid email excludes contacts until verification completes.");
  if (settings.contacts.requirePhone) warnings.push("Requiring a phone number excludes companies that publish only email or forms.");
  if (settings.quality.minSourceObservations > 1) warnings.push("Requiring several independent sources excludes single-source companies.");
  if (settings.language.websiteLanguages.length && !settings.language.allowUnknown) {
    warnings.push("Excluding unknown-language websites drops sites where language detection fails.");
  }
  if (industries.include.size === 0 && project.keywords.filter((k) => k.mode === "INCLUDE").length === 0) {
    warnings.push("No industry or keyword filter: every company in the geography is in scope.");
  }

  const maxRequests = project.maxCompanies * project.maxPagesPerCompany;
  const perDomainSeconds = 60 / settings.crawl.requestsPerDomainPerMinute;
  const estimatedCrawlHours =
    Math.round(((maxRequests * perDomainSeconds) / settings.crawl.globalConcurrency / 3600) * 10) / 10;
  if (estimatedCrawlHours > 24) warnings.push(`Crawl budget may take about ${estimatedCrawlHours} hours at the configured rate limits.`);

  // Count by the most specific level each include location names (city/region ids, else country).
  const cityIds = scope.includes.flatMap((l) => (l.level === "CITY" && l.cityId ? [l.cityId] : []));
  const regionIds = scope.includes.flatMap((l) => (l.level === "REGION" && l.regionId ? [l.regionId] : []));
  const broadCountries = scope.includes.some((l) => ["COUNTRY", "CONTINENT"].includes(l.level)) ? countries : [];
  const geoFilter = scope.worldwide
    ? {}
    : {
        OR: [
          ...(cityIds.length ? [{ locations: { some: { cityId: { in: cityIds } } } }] : []),
          ...(regionIds.length ? [{ locations: { some: { regionId: { in: regionIds } } } }] : []),
          ...(broadCountries.length ? [{ countryCode: { in: broadCountries } }] : []),
        ],
      };
  const companyWhere = {
    organizationId,
    deletedAt: null,
    ...(geoFilter.OR && geoFilter.OR.length ? geoFilter : {}),
    ...(industries.include.size ? { industries: { some: { industryId: { in: [...industries.include] } } } } : {}),
  };
  const [known, withDomain] = await Promise.all([
    prisma.company.count({ where: companyWhere }),
    prisma.company.count({ where: { ...companyWhere, domains: { some: {} } } }),
  ]);

  const industryName = new Map(project.industries.map((f) => [f.industryId, f.industry.name]));
  return {
    scope: {
      geography: scope.worldwide ? ["Worldwide"] : scope.includes.map((l) => l.label),
      excludedGeography: scope.excludes.map((l) => l.label),
      industries: project.industries.filter((f) => f.mode === "INCLUDE").map((f) => industryName.get(f.industryId)!),
      excludedIndustries: project.industries.filter((f) => f.mode === "EXCLUDE").map((f) => industryName.get(f.industryId)!),
      keywords: project.keywords.map((k) => `${k.mode === "EXCLUDE" ? "-" : ""}${k.keyword}`),
    },
    sources,
    budget: {
      maxCompanies: project.maxCompanies,
      maxPagesPerCompany: project.maxPagesPerCompany,
      maxCrawlDepth: project.maxCrawlDepth,
      maxRequests,
      estimatedCrawlHours,
    },
    estimates: {
      knownCompaniesInScope: known,
      knownCompaniesWithDomain: withDomain,
      note: "Counts of companies already in LeadForge that match the geography and industry filters. New discovery depends on source coverage.",
    },
    warnings,
    blockers,
    requiresApproval: needsApproval,
    approved: Boolean(project.approvedAt),
  };
}
