import Link from "next/link";
import { prisma } from "@leadforge/database";
import { limits, queueCounts } from "@leadforge/pipeline";
import { requireSession } from "@/lib/auth";
import { cached } from "@/lib/cache";
import { Card, Empty, PageHeader, Stat, StatusBadge, formatDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireSession();
  const org = session.organization.id;
  const staleBefore = new Date(Date.now() - limits.companyFreshnessDays * 86_400_000);

  const [companies, contacts, contactsWithEvidence, emails, crawls, duplicates, stale, needsReview, pendingCandidates, projects, queues] =
    await Promise.all([
      prisma.company.count({ where: { organizationId: org, deletedAt: null } }),
      prisma.contact.count({ where: { organizationId: org, deletedAt: null } }),
      prisma.contact.count({ where: { organizationId: org, deletedAt: null, OR: [{ evidence: { some: {} } }, { sourceUrl: { not: null } }] } }),
      cached(`dashboard:email-status:${org}`, 60_000, () =>
        prisma.emailAddress.groupBy({
          by: ["status"],
          where: { contacts: { some: { contact: { organizationId: org } } } },
          _count: { _all: true },
        }),
      ),
      prisma.crawlJob.groupBy({ by: ["status"], where: { organizationId: org }, _count: { _all: true } }),
      prisma.companyDuplicateCandidate.count({ where: { organizationId: org, status: "OPEN" } }),
      prisma.company.count({ where: { organizationId: org, deletedAt: null, lastSeenAt: { lt: staleBefore } } }),
      prisma.company.count({ where: { organizationId: org, deletedAt: null, reviewStatus: "NEEDS_REVIEW" } }),
      prisma.extractionCandidate.count({ where: { organizationId: org, status: "PENDING" } }),
      prisma.discoveryProject.findMany({
        where: { organizationId: org },
        orderBy: { updatedAt: "desc" },
        take: 6,
        include: { _count: { select: { companies: true } } },
      }),
      queueCounts(),
    ]);

  const email = Object.fromEntries(emails.map((e) => [e.status, e._count._all]));
  const crawl = Object.fromEntries(crawls.map((c) => [c.status, c._count._all]));
  const coverage = contacts ? Math.round((contactsWithEvidence / contacts) * 100) : 0;
  const queued = Object.values(queues ?? {}).reduce((n, q) => n + (q.waiting ?? 0) + (q.active ?? 0) + (q.delayed ?? 0), 0);

  return (
    <div className="space-y-7">
      <PageHeader
        title="Dashboard"
        description="Discovery pipeline health, data quality and the review backlog."
        actions={
          <Link href="/projects/new" className="btn btn-primary">
            New discovery project
          </Link>
        }
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Companies discovered" value={companies} href="/companies" />
        <Stat label="Contacts found" value={contacts} hint={`${coverage}% with source evidence`} href="/contacts" />
        <Stat label="MX valid" value={email.MX_VALID ?? 0} hint={`${email.SYNTAX_VALID ?? 0} syntax only · ${email.UNDELIVERABLE ?? 0} invalid/no MX`} />
        <Stat label="Unverified" value={(email.DISCOVERED ?? 0) + (email.DELIVERABILITY_UNKNOWN ?? 0)} hint="awaiting syntax/MX check" />
        <Stat label="Crawls succeeded" value={(crawl.SUCCEEDED ?? 0) + (crawl.PARTIAL ?? 0)} hint={`${crawl.FAILED ?? 0} failed · ${crawl.BLOCKED ?? 0} blocked`} href="/jobs" />
        <Stat label="Job queue" value={(crawl.QUEUED ?? 0) + (crawl.RUNNING ?? 0)} hint={queues ? `${queued} orchestration jobs` : "Redis not configured"} href="/jobs" />
        <Stat label="Duplicate candidates" value={duplicates} href="/duplicates" />
        <Stat label="Awaiting review" value={needsReview + pendingCandidates} hint={`${needsReview} companies · ${pendingCandidates} extractions`} href="/data-quality" />
        <Stat label="Stale records" value={stale} hint={`not observed in ${limits.companyFreshnessDays} days`} href="/companies?stale=true" />
      </section>

      <Card title="Recent discovery projects" actions={<Link href="/projects" className="text-xs underline muted">All projects</Link>}>
        {projects.length === 0 ? (
          <Empty>No projects yet. Create one to discover companies by geography and industry.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Project</th><th>Status</th><th>Companies</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td><Link className="font-medium hover:underline" href={`/projects/${p.id}`}>{p.name}</Link></td>
                  <td><StatusBadge status={p.status} /></td>
                  <td className="tabular-nums">{p._count.companies}</td>
                  <td className="text-xs muted">{formatDate(p.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
