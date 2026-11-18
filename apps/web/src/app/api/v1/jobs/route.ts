import type { NextRequest } from "next/server";
import { prisma, type CrawlJobStatus } from "@leadforge/database";
import { queueCounts } from "@leadforge/pipeline";
import { json, withAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["QUEUED", "RUNNING", "SUCCEEDED", "PARTIAL", "FAILED", "BLOCKED", "CANCELLED"]);

/** Crawl jobs and discovery runs, newest first, plus orchestration queue depth. */
export const GET = withAuth(async (request: NextRequest, session) => {
  const url = new URL(request.url);
  const status = url.searchParams.get("status")?.toUpperCase();
  const projectId = url.searchParams.get("projectId") ?? undefined;
  const statusFilter = status && STATUSES.has(status) ? { status: status as CrawlJobStatus } : {};
  const [crawlJobs, discoveryRuns, crawlCounts, queues] = await Promise.all([
    prisma.crawlJob.findMany({
      where: { organizationId: session.organization.id, ...(projectId ? { projectId } : {}), ...statusFilter },
      orderBy: { updatedAt: "desc" },
      take: 200,
      include: { company: { select: { id: true, name: true } }, project: { select: { id: true, name: true } } },
    }),
    prisma.discoveryRun.findMany({
      where: { organizationId: session.organization.id, ...(projectId ? { projectId } : {}), ...statusFilter },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { source: { select: { name: true } }, project: { select: { id: true, name: true } } },
    }),
    prisma.crawlJob.groupBy({
      by: ["status"],
      where: { organizationId: session.organization.id },
      _count: { _all: true },
    }),
    queueCounts(),
  ]);
  return json({
    data: {
      crawlJobs,
      discoveryRuns,
      crawlCounts: Object.fromEntries(crawlCounts.map((r) => [r.status, r._count._all])),
      queues,
    },
  });
}, "VIEWER");
