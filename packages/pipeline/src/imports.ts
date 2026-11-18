/**
 * User-provided company imports (spec section 10, source priority 1).
 *
 * A CSV import becomes an "import project" with worldwide scope whose rows are
 * staged as CompanyCandidates from the built-in "User-provided domains" source,
 * so imports go through exactly the same normalization, dedup and provenance
 * path as every other source.
 */
import { prisma, type Prisma } from "@leadforge/database";
import { discoveryProjectSettings } from "@leadforge/shared";
import { processPendingCandidates } from "./normalize";

export const USER_SOURCE_NAME = "User-provided domains";

export async function ensureUserSource(organizationId: string) {
  return prisma.source.upsert({
    where: { organizationId_name: { organizationId, name: USER_SOURCE_NAME } },
    create: {
      organizationId,
      name: USER_SOURCE_NAME,
      sourceType: "IMPORT",
      adapter: "domain_list",
      permitted: true,
      policyStatus: "APPROVED",
      automatedAccessAllowed: true,
      commercialReuseAllowed: true,
      permittedUse: "Domains and company records supplied by the operator. Only public pages of these sites are crawled.",
      policyNotes: "Built-in source for operator-supplied data.",
      tosReviewedAt: new Date(),
    },
    update: {},
  });
}

export interface ImportRow {
  name: string;
  domain: string;
  website?: string;
  countryCode?: string;
  city?: string;
  region?: string;
  industry?: string;
  registrationNumber?: string;
}

export async function stageImport(input: {
  organizationId: string;
  userId: string | null;
  filename: string;
  rows: ImportRow[];
  importJobId: string;
}): Promise<{ projectId: string; staged: number; processed: number }> {
  const source = await ensureUserSource(input.organizationId);
  const settings = discoveryProjectSettings.parse({ company: { domainRequired: true } });
  const project = await prisma.discoveryProject.create({
    data: {
      organizationId: input.organizationId,
      createdById: input.userId && !input.userId.startsWith("api-key") ? input.userId : null,
      name: `Import: ${input.filename}`,
      description: `Created by CSV import ${input.importJobId}`,
      status: "RUNNING",
      geographicMode: "WORLDWIDE",
      maxCompanies: Math.max(1, input.rows.length),
      settings: settings as Prisma.InputJsonValue,
      startedAt: new Date(),
      sources: { create: { sourceId: source.id } },
    },
  });
  await prisma.discoveryRun.create({
    data: {
      organizationId: input.organizationId,
      projectId: project.id,
      sourceId: source.id,
      status: "SUCCEEDED",
      candidatesFound: input.rows.length,
      startedAt: new Date(),
      finishedAt: new Date(),
      query: { importJobId: input.importJobId },
    },
  });

  const result = await prisma.companyCandidate.createMany({
    data: input.rows.map((row, index) => ({
      organizationId: input.organizationId,
      projectId: project.id,
      sourceId: source.id,
      sourceRecordId: `${input.importJobId}:${index + 1}`,
      sourceUrl: null,
      name: row.name,
      website: row.website ?? `https://${row.domain}`,
      countryIso2: row.countryCode ?? null,
      cityName: row.city ?? null,
      regionName: row.region ?? null,
      industryLabel: row.industry ?? null,
      registrationNumber: row.registrationNumber ?? null,
      raw: row as unknown as Prisma.InputJsonValue,
      licence: "operator-supplied",
    })),
    skipDuplicates: true,
  });

  // Small imports are normalized inline so the response reflects the outcome;
  // larger ones are left to the company_normalization worker.
  const processed = input.rows.length <= 500 ? await processPendingCandidates(input.rows.length, project.id) : 0;
  return { projectId: project.id, staged: result.count, processed };
}
