import type { NextRequest } from "next/server";
import { prisma, type Prisma } from "@leadforge/database";
import { classify, companyWhere, resolveLocation } from "@leadforge/pipeline";
import {
  ApiError,
  companyCreate,
  companyListQuery,
  decodeCursor,
  normalizeCompanyName,
  normalizeRegistrationNumber,
  paginationResult,
  parseBody,
  parseQuery,
  registrableDomain,
  topLevelDomain,
} from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit, emit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (request: NextRequest, session) => {
  const query = parseQuery(new URL(request.url), companyListQuery);
  const where = await companyWhere(session.organization.id, query);
  if (query.cursor) {
    const c = decodeCursor<{ t: string; id: string }>(query.cursor);
    (where.AND as Prisma.CompanyWhereInput[]).push({
      OR: [{ updatedAt: { lt: new Date(c.t) } }, { updatedAt: new Date(c.t), id: { lt: c.id } }],
    });
  }
  const rows = await prisma.company.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    include: {
      domains: { include: { domain: true } },
      locations: { take: 1, orderBy: { isHeadquarters: "desc" }, include: { city: { select: { name: true } } } },
      industries: { include: { industry: { select: { name: true, code: true } } }, orderBy: { isPrimary: "desc" } },
      _count: { select: { contacts: true, evidence: true } },
    },
  });
  return json(paginationResult(rows, query.limit, (row) => ({ t: row.updatedAt.toISOString(), id: row.id })));
}, "VIEWER");

export const POST = withAuth(async (request: NextRequest, session) => {
  const input = await parseBody(request, companyCreate);
  const organizationId = session.organization.id;
  const domainName = input.website ? registrableDomain(input.website) : null;
  if (input.website && !domainName) throw new ApiError(400, "VALIDATION_ERROR", "Website is not a public domain");
  if (domainName) {
    const taken = await prisma.companyDomain.findFirst({
      where: { domain: { domain: domainName }, company: { organizationId, deletedAt: null } },
      select: { companyId: true },
    });
    if (taken) throw new ApiError(409, "CONFLICT", "A company with this domain already exists", { companyId: taken.companyId });
  }

  const place = await resolveLocation(prisma, { countryIso2: input.countryCode, cityName: input.city });
  const industries = input.industryIds.length
    ? input.industryIds.map((industryId) => ({ industryId, confidence: 0.95, method: "MANUAL" as const, evidence: "manual entry" }))
    : (await classify({ label: input.industryLabel, text: input.description })).map((m) => ({
        industryId: m.industryId,
        confidence: m.confidence,
        method: m.method,
        evidence: m.evidence,
      }));

  const company = await prisma.$transaction(async (tx) => {
    const created = await tx.company.create({
      data: {
        organizationId,
        name: input.name,
        normalizedName: normalizeCompanyName(input.name),
        legalName: input.legalName,
        description: input.description,
        countryCode: place.countryIso2 ?? input.countryCode,
        industryLabel: input.industryLabel,
        registrationNumber: normalizeRegistrationNumber(input.registrationNumber),
        employeeRange: input.employeeRange,
        website: input.website,
        websiteStatus: domainName ? "UNKNOWN" : "ABSENT",
        tags: input.tags,
        confidence: 0.6,
        reviewStatus: "REVIEWED",
        reviewedAt: new Date(),
      },
    });
    if (place.countryIso2 || input.city) {
      await tx.companyLocation.create({
        data: {
          companyId: created.id,
          locationType: "HEADQUARTERS",
          isHeadquarters: true,
          rawText: input.city ?? null,
          countryIso2: place.countryIso2,
          regionId: input.regionId ?? place.regionId,
          cityId: input.cityId ?? place.cityId,
          latitude: place.latitude,
          longitude: place.longitude,
          confidence: input.cityId ? 0.95 : place.confidence,
          resolution: input.cityId ? "RESOLVED" : place.resolution,
        },
      });
    }
    for (const [index, industry] of industries.entries()) {
      await tx.companyIndustry.create({ data: { companyId: created.id, isPrimary: index === 0, ...industry } });
    }
    if (domainName) {
      const domain = await tx.domain.upsert({
        where: { domain: domainName },
        create: { domain: domainName, registrableDomain: domainName, tld: topLevelDomain(domainName), nextCrawlAt: new Date() },
        update: {},
      });
      await tx.companyDomain.create({
        data: { companyId: created.id, domainId: domain.id, isPrimary: true, verifiedAt: new Date() },
      });
      await tx.sourceEvidence.create({
        data: {
          organizationId,
          companyId: created.id,
          domainId: domain.id,
          pageUrl: input.website!,
          fieldName: "domain",
          extractedValue: domainName,
          method: "manual",
        },
      });
    }
    await emit(tx, { organizationId, type: "company.created", aggregateType: "Company", aggregateId: created.id });
    return created;
  });

  await audit({
    organizationId,
    actorId: session.user.id,
    action: "company.create",
    entity: "Company",
    entityId: company.id,
  });
  return json({ data: company }, 201);
}, "ANALYST");
