/** Project progress and completion (spec section 29: a project completes when all jobs are terminal). */
import { prisma } from "@leadforge/database";

const TERMINAL = ["SUCCEEDED", "PARTIAL", "FAILED", "BLOCKED", "CANCELLED"] as const;

function tally(rows: { status: string; _count: { _all: number } }[]): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
}

export async function projectProgress(projectId: string) {
  const [runs, candidates, crawls, companies, contacts, emails, pages, blocked] = await Promise.all([
    prisma.discoveryRun.groupBy({ by: ["status"], where: { projectId }, _count: { _all: true } }),
    prisma.companyCandidate.groupBy({ by: ["status"], where: { projectId }, _count: { _all: true } }),
    prisma.crawlJob.groupBy({ by: ["status"], where: { projectId }, _count: { _all: true } }),
    prisma.projectCompany.count({ where: { projectId } }),
    prisma.contact.count({ where: { company: { projects: { some: { projectId } } }, deletedAt: null } }),
    prisma.emailAddress.groupBy({
      by: ["status"],
      where: { contacts: { some: { contact: { company: { projects: { some: { projectId } } } } } } },
      _count: { _all: true },
    }),
    prisma.crawlJob.aggregate({
      where: { projectId },
      _sum: { pagesFetched: true, pagesSkipped: true, bytesDownloaded: true },
    }),
    prisma.crawlJob.findMany({
      where: { projectId, status: "BLOCKED" },
      select: { rootUrl: true, policyStopReason: true, errorCode: true },
      take: 20,
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  const rejectReasons = await prisma.companyCandidate.groupBy({
    by: ["rejectReason"],
    where: { projectId, status: "REJECTED" },
    _count: { _all: true },
  });
  const runRows = await prisma.discoveryRun.findMany({
    where: { projectId },
    select: {
      id: true,
      status: true,
      candidatesFound: true,
      errorCode: true,
      errorMessage: true,
      policyStopReason: true,
      source: { select: { name: true } },
      finishedAt: true,
    },
  });
  return {
    runs: tally(runs),
    runDetails: runRows,
    candidates: tally(candidates),
    rejectReasons: Object.fromEntries(rejectReasons.map((r) => [r.rejectReason ?? "unknown", r._count._all])),
    crawls: tally(crawls),
    companies,
    contacts,
    emails: tally(emails),
    pagesFetched: pages._sum.pagesFetched ?? 0,
    pagesSkipped: pages._sum.pagesSkipped ?? 0,
    bytesDownloaded: pages._sum.bytesDownloaded ?? 0,
    policyStops: blocked,
  };
}

/** Mark RUNNING projects COMPLETED/FAILED once every run, candidate and crawl job is terminal. */
export async function finalizeProjects(): Promise<string[]> {
  const running = await prisma.discoveryProject.findMany({ where: { status: "RUNNING" }, select: { id: true } });
  const finished: string[] = [];
  for (const { id } of running) {
    const [openRuns, pending, openCrawls, runs, companies] = await Promise.all([
      prisma.discoveryRun.count({ where: { projectId: id, status: { notIn: [...TERMINAL] } } }),
      prisma.companyCandidate.count({ where: { projectId: id, status: "PENDING" } }),
      prisma.crawlJob.count({ where: { projectId: id, status: { notIn: [...TERMINAL] } } }),
      prisma.discoveryRun.findMany({ where: { projectId: id }, select: { status: true, errorMessage: true } }),
      prisma.projectCompany.count({ where: { projectId: id } }),
    ]);
    if (openRuns || pending || openCrawls || runs.length === 0) continue;
    const allFailed = runs.every((r) => r.status === "FAILED" || r.status === "BLOCKED");
    await prisma.discoveryProject.update({
      where: { id },
      data: {
        status: allFailed && companies === 0 ? "FAILED" : "COMPLETED",
        finishedAt: new Date(),
        lastError: allFailed ? runs.map((r) => r.errorMessage).filter(Boolean).join("; ").slice(0, 1000) || null : null,
      },
    });
    finished.push(id);
  }
  return finished;
}
