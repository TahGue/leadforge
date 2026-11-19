import Link from "next/link";
import { prisma, type CrawlJobStatus } from "@leadforge/database";
import { queueCounts } from "@leadforge/pipeline";
import { requireSession } from "@/lib/auth";
import { ActionButton } from "@/components/action-button";
import { Card, Empty, PageHeader, StatusBadge, formatBytes, formatDate } from "@/components/ui";

export const dynamic = "force-dynamic";

const STATUSES: CrawlJobStatus[] = ["QUEUED", "RUNNING", "SUCCEEDED", "PARTIAL", "FAILED", "BLOCKED", "CANCELLED"];

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ status?: string; job?: string }> }) {
  const session = await requireSession();
  const { status, job } = await searchParams;
  const filter = STATUSES.includes(status as CrawlJobStatus) ? { status: status as CrawlJobStatus } : {};
  const org = session.organization.id;
  const [crawls, runs, counts, queues, detail] = await Promise.all([
    prisma.crawlJob.findMany({
      where: { organizationId: org, ...filter },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: { company: { select: { id: true, name: true } }, project: { select: { id: true, name: true } } },
    }),
    prisma.discoveryRun.findMany({
      where: { organizationId: org },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { source: { select: { name: true } }, project: { select: { id: true, name: true } } },
    }),
    prisma.crawlJob.groupBy({ by: ["status"], where: { organizationId: org }, _count: { _all: true } }),
    queueCounts(),
    job
      ? prisma.crawlJob.findFirst({ where: { id: job, organizationId: org }, include: { pages: { orderBy: { fetchedAt: "asc" } }, company: { select: { name: true } } } })
      : null,
  ]);
  const countMap = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));
  const retryable = ["FAILED", "BLOCKED", "PARTIAL", "CANCELLED"];

  return (
    <div className="space-y-6">
      <PageHeader title="Jobs" description="Discovery runs and website crawls. Policy stops (robots, 401/403/429, CAPTCHA) are terminal and are never retried automatically." />

      <nav className="flex flex-wrap gap-1 text-xs">
        <Link className={`rounded-md px-2.5 py-1 ${!status ? "bg-[var(--lf-ink)] text-white" : "hover:bg-[#f1f1ee]"}`} href="/jobs">All</Link>
        {STATUSES.map((s) => (
          <Link key={s} className={`rounded-md px-2.5 py-1 ${status === s ? "bg-[var(--lf-ink)] text-white" : "hover:bg-[#f1f1ee]"}`} href={`/jobs?status=${s}`}>
            {s.toLowerCase()} ({countMap[s] ?? 0})
          </Link>
        ))}
      </nav>

      {queues ? (
        <Card title="Orchestration queues (BullMQ)">
          <table className="table">
            <thead><tr><th>Queue</th><th>Waiting</th><th>Active</th><th>Delayed</th><th>Failed</th></tr></thead>
            <tbody>
              {Object.entries(queues).map(([name, c]) => (
                <tr key={name}><td className="font-mono text-xs">{name}</td><td>{c.waiting ?? 0}</td><td>{c.active ?? 0}</td><td>{c.delayed ?? 0}</td><td>{c.failed ?? 0}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <p className="text-xs muted">Redis is not configured: orchestration falls back to the Postgres sweep in the worker.</p>
      )}

      {detail ? (
        <Card title={`Crawl of ${detail.rootUrl} — ${detail.company?.name ?? ""}`}>
          <table className="table">
            <thead><tr><th>Page</th><th>Kind</th><th>HTTP</th><th>Bytes</th><th>ms</th><th>Parse</th></tr></thead>
            <tbody>
              {detail.pages.map((p) => (
                <tr key={p.id}>
                  <td className="max-w-[22rem] truncate font-mono text-xs">{p.url}</td>
                  <td className="text-xs">{p.pageKind}</td>
                  <td>{p.httpStatus ?? "—"}</td>
                  <td className="text-xs">{formatBytes(p.bytesReceived)}</td>
                  <td className="text-xs">{p.durationMs}</td>
                  <td className="text-xs">{p.parseStatus}{p.skipReason ? ` · ${p.skipReason}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      <Card title="Website crawls">
        {crawls.length === 0 ? <Empty>No crawl jobs.</Empty> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Site</th><th>Company</th><th>Project</th><th>Status</th><th>Pages</th><th>Bytes</th><th>Attempts</th><th>Reason</th><th>Updated</th><th /></tr></thead>
              <tbody>
                {crawls.map((j) => (
                  <tr key={j.id}>
                    <td className="font-mono text-xs"><Link className="hover:underline" href={`/jobs?job=${j.id}`}>{j.rootUrl.replace(/^https?:\/\//, "")}</Link></td>
                    <td className="text-xs">{j.company ? <Link className="hover:underline" href={`/companies/${j.company.id}`}>{j.company.name}</Link> : "—"}</td>
                    <td className="text-xs">{j.project ? <Link className="hover:underline" href={`/projects/${j.project.id}`}>{j.project.name}</Link> : "ad hoc"}</td>
                    <td><StatusBadge status={j.status} /></td>
                    <td className="tabular-nums text-xs">{j.pagesFetched}/{j.maxPages}</td>
                    <td className="text-xs">{formatBytes(j.bytesDownloaded)}</td>
                    <td className="text-xs">{j.attemptCount}/{j.maxAttempts}</td>
                    <td className="max-w-[14rem] truncate text-xs muted" title={j.policyStopReason ?? j.errorMessage ?? ""}>{j.policyStopReason ?? j.errorCode ?? "—"}</td>
                    <td className="text-xs muted">{formatDate(j.updatedAt)}</td>
                    <td>{retryable.includes(j.status) ? <ActionButton url={`/api/v1/jobs/${j.id}/retry`} label="Retry" confirmText={j.status === "BLOCKED" ? "This crawl was stopped by a source policy. Re-queue only if the cause is resolved." : undefined} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Discovery runs">
        {runs.length === 0 ? <Empty>No discovery runs.</Empty> : (
          <table className="table">
            <thead><tr><th>Project</th><th>Source</th><th>Status</th><th>Records</th><th>Attempts</th><th>Error</th><th /></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="text-xs"><Link className="hover:underline" href={`/projects/${r.project.id}`}>{r.project.name}</Link></td>
                  <td className="text-xs">{r.source.name}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="tabular-nums">{r.candidatesFound}</td>
                  <td className="text-xs">{r.attemptCount}/{r.maxAttempts}</td>
                  <td className="max-w-[16rem] truncate text-xs muted">{r.policyStopReason ?? r.errorMessage ?? "—"}</td>
                  <td>{retryable.includes(r.status) ? <ActionButton url={`/api/v1/jobs/${r.id}/retry`} label="Retry" /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
