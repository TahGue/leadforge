import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { cursorQuery, decodeCursor, paginationResult, parseQuery } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (request: NextRequest, session) => {
  const url = new URL(request.url);
  const { cursor, limit } = parseQuery(url, cursorQuery);
  const status = url.searchParams.get("status") ?? "PENDING";

  const where = {
    organizationId: session.organization.id,
    status: status as "PENDING" | "PROMOTED" | "REJECTED",
  };

  const rows = await prisma.extractionCandidate.findMany({
    where: cursor
      ? {
          ...where,
          AND: [
            {
              OR: [
                { createdAt: { lt: new Date(decodeCursor<{ t: string }>(cursor).t) } },
                {
                  createdAt: new Date(decodeCursor<{ t: string }>(cursor).t),
                  id: { lt: decodeCursor<{ id: string }>(cursor).id },
                },
              ],
            },
          ],
        }
      : where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    include: {
      company: { select: { id: true, name: true, countryCode: true } },
      artifact: { select: { url: true, fetchedAt: true } },
    },
  });

  const counts = await prisma.extractionCandidate.groupBy({
    by: ["status"],
    where: { organizationId: session.organization.id },
    _count: true,
  });

  return json({
    ...paginationResult(rows, limit, (row) => ({
      t: row.createdAt.toISOString(),
      id: row.id,
    })),
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
  });
}, "VIEWER");
