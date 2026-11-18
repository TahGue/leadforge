import { prisma } from "@leadforge/database";
import { ApiError } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

/** A crawl job (with its pages) or a discovery run, by id. */
export const GET = withAuth<{ id: string }>(async (_request, session, params) => {
  const crawl = await prisma.crawlJob.findFirst({
    where: { id: params.id, organizationId: session.organization.id },
    include: { pages: { orderBy: { fetchedAt: "asc" } }, company: { select: { id: true, name: true } } },
  });
  if (crawl) return json({ data: { kind: "crawl", ...crawl } });
  const run = await prisma.discoveryRun.findFirst({
    where: { id: params.id, organizationId: session.organization.id },
    include: { source: { select: { name: true } } },
  });
  if (run) return json({ data: { kind: "discovery", ...run } });
  throw new ApiError(404, "NOT_FOUND", "Job not found");
}, "VIEWER");
