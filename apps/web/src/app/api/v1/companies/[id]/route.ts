import { prisma, type Prisma } from "@leadforge/database";
import { ApiError, companyUpdate, normalizeCompanyName, parseBody } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ id: string }>(async (_request, session, params) => {
  const company = await prisma.company.findFirst({
    where: { id: params.id, organizationId: session.organization.id, deletedAt: null },
    include: {
      domains: { include: { domain: true } },
      locations: { include: { city: true, region: true, country: { select: { name: true } } } },
      industries: { include: { industry: { select: { code: true, name: true } } } },
      contacts: {
        where: { deletedAt: null },
        include: {
          emails: {
            include: { email: { include: { verifications: { orderBy: { checkedAt: "desc" }, take: 1 } } } },
          },
        },
        orderBy: { updatedAt: "desc" },
      },
      evidence: { orderBy: { observedAt: "desc" }, take: 50 },
      observations: { orderBy: { observedAt: "desc" }, take: 100, include: { source: { select: { name: true } } } },
      projects: { include: { project: { select: { id: true, name: true } } } },
    },
  });
  if (!company) throw new ApiError(404, "NOT_FOUND", "Company not found");
  return json({ data: company });
}, "VIEWER");

export const PATCH = withAuth<{ id: string }>(async (request, session, params) => {
  const input = await parseBody(request, companyUpdate);
  const existing = await prisma.company.findFirst({
    where: { id: params.id, organizationId: session.organization.id, deletedAt: null },
  });
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Company not found");

  const { industryIds, city: _city, cityId, regionId, ...fields } = input;
  void _city;
  const data: Prisma.CompanyUpdateInput = {
    ...fields,
    ...(fields.name ? { normalizedName: normalizeCompanyName(fields.name) } : {}),
    ...(fields.reviewStatus === "REVIEWED" ? { reviewedAt: new Date() } : {}),
  };
  const updated = await prisma.$transaction(async (tx) => {
    const company = await tx.company.update({ where: { id: existing.id }, data });
    if (industryIds && industryIds.length) {
      await tx.companyIndustry.deleteMany({ where: { companyId: existing.id, method: "MANUAL" } });
      for (const [index, industryId] of industryIds.entries()) {
        await tx.companyIndustry.upsert({
          where: { companyId_industryId: { companyId: existing.id, industryId } },
          create: { companyId: existing.id, industryId, isPrimary: index === 0, confidence: 0.95, method: "MANUAL" },
          update: { isPrimary: index === 0, method: "MANUAL", confidence: 0.95 },
        });
      }
    }
    if (cityId) {
      const city = await tx.city.findUnique({ where: { id: cityId } });
      if (!city) throw new ApiError(400, "VALIDATION_ERROR", "Unknown city");
      await tx.companyLocation.create({
        data: {
          companyId: existing.id,
          locationType: "HEADQUARTERS",
          isHeadquarters: true,
          countryIso2: city.countryIso2,
          regionId: regionId ?? city.regionId,
          cityId: city.id,
          latitude: city.latitude,
          longitude: city.longitude,
          confidence: 0.95,
          resolution: "RESOLVED",
        },
      });
    }
    return company;
  });

  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "company.update",
    entity: "Company",
    entityId: updated.id,
    metadata: { fields: Object.keys(input) },
  });
  return json({ data: updated });
}, "ANALYST");
