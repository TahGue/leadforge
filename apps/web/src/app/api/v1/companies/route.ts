import type { NextRequest } from "next/server";
import { prisma, type Prisma } from "@leadforge/database";
import {
  companyCreate,
  cursorQuery,
  decodeCursor,
  paginationResult,
  parseBody,
  parseQuery,
} from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit, emit } from "@/lib/audit";
import { normalizeDomain } from "@/lib/csv";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (request: NextRequest, session) => {
  const url = new URL(request.url);
  const { cursor, limit } = parseQuery(url, cursorQuery);
  const q = url.searchParams.get("q")?.trim();
  const country = url.searchParams.get("country")?.toUpperCase();

  const where: Prisma.CompanyWhereInput = {
    organizationId: session.organization.id,
    deletedAt: null,
    ...(country ? { countryCode: country } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { domains: { some: { domain: { domain: { contains: q, mode: "insensitive" } } } } },
          ],
        }
      : {}),
  };

  if (cursor) {
    const c = decodeCursor<{ t: string; id: string }>(cursor);
    where.AND = [
      {
        OR: [
          { updatedAt: { lt: new Date(c.t) } },
          { updatedAt: new Date(c.t), id: { lt: c.id } },
        ],
      },
    ];
  }

  const rows = await prisma.company.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    include: {
      domains: { include: { domain: true } },
      _count: { select: { contacts: true } },
    },
  });

  return json(
    paginationResult(rows, limit, (row) => ({ t: row.updatedAt.toISOString(), id: row.id })),
  );
}, "VIEWER");

export const POST = withAuth(async (request: NextRequest, session) => {
  const input = await parseBody(request, companyCreate);

  const company = await prisma.$transaction(async (tx) => {
    const created = await tx.company.create({
      data: {
        organizationId: session.organization.id,
        name: input.name,
        legalName: input.legalName,
        description: input.description,
        countryCode: input.countryCode,
        city: input.city,
        industry: input.industry,
        employeeRange: input.employeeRange,
        website: input.website,
        confidence: 0.6,
      },
    });

    if (input.website) {
      const domainName = normalizeDomain(input.website);
      if (domainName) {
        const tld = domainName.split(".").slice(-1)[0] ?? "";
        const domain = await tx.domain.upsert({
          where: { domain: domainName },
          create: {
            domain: domainName,
            registrableDomain: domainName,
            tld,
            nextCrawlAt: new Date(),
          },
          update: {},
        });
        await tx.companyDomain.create({
          data: {
            companyId: created.id,
            domainId: domain.id,
            isPrimary: true,
            verifiedAt: new Date(),
          },
        });
        await tx.sourceEvidence.create({
          data: {
            organizationId: session.organization.id,
            companyId: created.id,
            domainId: domain.id,
            pageUrl: input.website,
            fieldName: "domain",
            extractedValue: domainName,
            method: "manual",
          },
        });
      }
    }

    await emit(tx, {
      organizationId: session.organization.id,
      type: "company.created",
      aggregateType: "Company",
      aggregateId: created.id,
    });
    return created;
  });

  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "company.create",
    entity: "Company",
    entityId: company.id,
  });

  return json({ data: company }, 201);
}, "ANALYST");
