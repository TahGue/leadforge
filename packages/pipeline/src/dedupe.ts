/**
 * Company deduplication (spec section 14). Automatic merges happen only in
 * normalization on domain or registration number. Everything weaker becomes a
 * CompanyDuplicateCandidate that a person merges or dismisses.
 */
import { prisma } from "@leadforge/database";
import { ApiError } from "@leadforge/shared";

/** Scan an organization for duplicate signals not yet recorded. Returns how many candidates were added. */
export async function scanDuplicates(organizationId: string, limit = 500): Promise<number> {
  const pairs = await prisma.$queryRaw<{ a: string; b: string; signal: string; value: string }[]>`
    SELECT LEAST(c1.id, c2.id) AS a, GREATEST(c1.id, c2.id) AS b, 'normalized_name+country' AS signal,
           c1."normalizedName" AS value
    FROM "Company" c1
    JOIN "Company" c2
      ON c1."organizationId" = c2."organizationId"
     AND c1."normalizedName" = c2."normalizedName"
     AND c1."normalizedName" <> ''
     AND COALESCE(c1."countryCode", '') = COALESCE(c2."countryCode", '')
     AND c1.id < c2.id
    WHERE c1."organizationId" = ${organizationId} AND c1."deletedAt" IS NULL AND c2."deletedAt" IS NULL
    UNION
    SELECT LEAST(k1."companyId", k2."companyId"), GREATEST(k1."companyId", k2."companyId"), 'phone', k1."phoneE164"
    FROM "Contact" k1
    JOIN "Contact" k2 ON k1."phoneE164" = k2."phoneE164" AND k1."companyId" < k2."companyId"
    WHERE k1."organizationId" = ${organizationId} AND k1."phoneE164" IS NOT NULL
      AND k1."isRoleBased" = true AND k2."isRoleBased" = true
    LIMIT ${limit}`;
  let added = 0;
  for (const pair of pairs) {
    const existing = await prisma.companyDuplicateCandidate.findUnique({
      where: { companyAId_companyBId: { companyAId: pair.a, companyBId: pair.b } },
    });
    if (existing) continue;
    await prisma.companyDuplicateCandidate.create({
      data: {
        organizationId,
        companyAId: pair.a,
        companyBId: pair.b,
        score: pair.signal === "phone" ? 0.7 : 0.6,
        signals: [{ signal: pair.signal, value: pair.value }],
      },
    });
    added += 1;
  }
  return added;
}

/** Merge `dropId` into `keepId`. Relationships move; the dropped company is archived, not deleted. */
export async function mergeCompanies(organizationId: string, keepId: string, dropId: string, actorId: string | null) {
  if (keepId === dropId) throw new ApiError(400, "VALIDATION_ERROR", "Cannot merge a company into itself");
  const [keep, drop] = await Promise.all([
    prisma.company.findFirst({ where: { id: keepId, organizationId, deletedAt: null } }),
    prisma.company.findFirst({ where: { id: dropId, organizationId, deletedAt: null } }),
  ]);
  if (!keep || !drop) throw new ApiError(404, "NOT_FOUND", "Company not found");

  await prisma.$transaction(async (tx) => {
    await tx.companyDomain.updateMany({ where: { companyId: dropId }, data: { companyId: keepId, isPrimary: false } });
    await tx.contact.updateMany({ where: { companyId: dropId }, data: { companyId: keepId } });
    await tx.sourceEvidence.updateMany({ where: { companyId: dropId }, data: { companyId: keepId } });
    await tx.sourceObservation.updateMany({ where: { companyId: dropId }, data: { companyId: keepId } });
    await tx.companyLocation.updateMany({ where: { companyId: dropId }, data: { companyId: keepId } });
    await tx.extractionCandidate.updateMany({ where: { companyId: dropId }, data: { companyId: keepId } });
    await tx.crawlJob.updateMany({ where: { companyId: dropId }, data: { companyId: keepId } });
    await tx.companyCandidate.updateMany({ where: { companyId: dropId }, data: { companyId: keepId } });

    const industries = await tx.companyIndustry.findMany({ where: { companyId: dropId } });
    for (const row of industries) {
      const clash = await tx.companyIndustry.findUnique({
        where: { companyId_industryId: { companyId: keepId, industryId: row.industryId } },
      });
      if (clash) await tx.companyIndustry.delete({ where: { id: row.id } });
      else await tx.companyIndustry.update({ where: { id: row.id }, data: { companyId: keepId, isPrimary: false } });
    }
    const links = await tx.projectCompany.findMany({ where: { companyId: dropId } });
    for (const link of links) {
      await tx.projectCompany.upsert({
        where: { projectId_companyId: { projectId: link.projectId, companyId: keepId } },
        create: { ...link, companyId: keepId },
        update: {},
      });
    }
    await tx.projectCompany.deleteMany({ where: { companyId: dropId } });

    await tx.company.update({
      where: { id: keepId },
      data: {
        description: keep.description ?? drop.description,
        registrationNumber: keep.registrationNumber ?? drop.registrationNumber,
        legalForm: keep.legalForm ?? drop.legalForm,
        employeeRange: keep.employeeRange ?? drop.employeeRange,
        foundedYear: keep.foundedYear ?? drop.foundedYear,
        website: keep.website ?? drop.website,
        tags: [...new Set([...keep.tags, ...drop.tags])],
        firstSeenAt: keep.firstSeenAt < drop.firstSeenAt ? keep.firstSeenAt : drop.firstSeenAt,
      },
    });
    await tx.company.update({
      where: { id: dropId },
      data: { deletedAt: new Date(), status: "ARCHIVED", tags: [...drop.tags, `merged-into:${keepId}`] },
    });
    await tx.companyDuplicateCandidate.updateMany({
      where: { OR: [{ companyAId: dropId }, { companyBId: dropId }], status: "OPEN" },
      data: { status: "MERGED", reviewedBy: actorId, reviewedAt: new Date() },
    });
  });
}
