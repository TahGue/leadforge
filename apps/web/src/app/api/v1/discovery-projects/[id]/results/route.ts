import type { NextRequest } from "next/server";
import { prisma, type Prisma } from "@leadforge/database";
import { companyWhere, projectResultWhere } from "@leadforge/pipeline";
import { ApiError, companyListQuery, decodeCursor, paginationResult, parseQuery } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ id: string }>(async (request: NextRequest, session, params) => {
  const project = await prisma.discoveryProject.findFirst({
    where: { id: params.id, organizationId: session.organization.id },
    select: { id: true },
  });
  if (!project) throw new ApiError(404, "NOT_FOUND", "Project not found");
  const query = parseQuery(new URL(request.url), companyListQuery);
  const where = await companyWhere(session.organization.id, { ...query, projectId: project.id });
  // ?strict=1 applies the project's post-crawl filters (website, contact, quality).
  if (new URL(request.url).searchParams.get("strict") === "1") {
    (where.AND as Prisma.CompanyWhereInput[]).push(await projectResultWhere(project.id));
  }
  if (query.cursor) {
    const c = decodeCursor<{ id: string }>(query.cursor);
    (where.AND as Prisma.CompanyWhereInput[]).push({ id: { lt: c.id } });
  }
  const rows = await prisma.company.findMany({
    where,
    orderBy: { id: "desc" },
    take: query.limit + 1,
    include: {
      domains: { where: { isPrimary: true }, include: { domain: { select: { domain: true } } } },
      locations: { take: 1, include: { city: { select: { name: true } } } },
      industries: { include: { industry: { select: { name: true } } }, orderBy: { isPrimary: "desc" } },
      _count: { select: { contacts: true, evidence: true } },
    },
  });
  return json(paginationResult(rows, query.limit, (row) => ({ id: row.id })));
}, "VIEWER");
