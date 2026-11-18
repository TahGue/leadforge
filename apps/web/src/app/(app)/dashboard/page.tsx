import Link from "next/link";
import { prisma } from "@leadforge/database";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs muted">{hint}</p> : null}
    </div>
  );
}

export default async function DashboardPage() {
  const session = await requireSession();
  const orgId = session.organization.id;

  const [companies, contacts, emails, pendingCandidates, campaigns, suppressions, recent] =
    await Promise.all([
      prisma.company.count({ where: { organizationId: orgId, deletedAt: null } }),
      prisma.contact.count({ where: { organizationId: orgId, deletedAt: null } }),
      prisma.emailAddress.count({
        where: { contacts: { some: { contact: { organizationId: orgId } } } },
      }),
      prisma.extractionCandidate.count({ where: { organizationId: orgId, status: "PENDING" } }),
      prisma.campaign.count({ where: { organizationId: orgId } }),
      prisma.suppressionEntry.count({
        where: { OR: [{ organizationId: orgId }, { organizationId: null }], liftedAt: null },
      }),
      prisma.extractionCandidate.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { company: { select: { name: true } } },
      }),
    ]);

  const verified = await prisma.emailAddress.count({
    where: {
      status: { in: ["MX_VALID", "DELIVERABILITY_UNKNOWN"] },
      contacts: { some: { contact: { organizationId: orgId } } },
    },
  });

  return (
    <div className="space-y-7">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm muted">
            Pipeline health, review backlog and the state of your lead graph.
          </p>
        </div>
        <Link href="/companies" className="btn btn-primary">
          Add companies
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Companies" value={companies} />
        <Stat label="Contacts" value={contacts} />
        <Stat label="Emails" value={emails} hint={`${verified} verified`} />
        <Stat label="Review backlog" value={pendingCandidates} hint="candidates pending" />
        <Stat label="Campaigns" value={campaigns} />
        <Stat label="Suppressed" value={suppressions} hint="global + org" />
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--lf-line)] px-4 py-3">
          <h2 className="text-sm font-semibold">Latest extraction candidates</h2>
          <Link href="/review" className="text-xs underline muted">
            Open review queue
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="px-4 py-8 text-sm muted">
            No candidates yet. Add companies, start a discovery project, and run the crawler worker.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Value</th>
                <th>Company</th>
                <th>Method</th>
                <th>Confidence</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((candidate) => (
                <tr key={candidate.id}>
                  <td className="font-mono text-xs">{candidate.normalizedValue}</td>
                  <td>{candidate.company?.name ?? "—"}</td>
                  <td className="text-xs muted">{candidate.method}</td>
                  <td className="tabular-nums">{candidate.confidence.toFixed(2)}</td>
                  <td>
                    <span className={`badge ${candidate.status === "PROMOTED" ? "badge-green" : ""}`}>
                      {candidate.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="card p-4">
          <h3 className="text-sm font-semibold">1 · Import</h3>
          <p className="mt-1 text-sm muted">Seed companies and domains from CSV.</p>
          <Link href="/companies" className="mt-2 inline-block text-sm underline">
            Import companies →
          </Link>
        </div>
        <div className="card p-4">
          <h3 className="text-sm font-semibold">2 · Discover</h3>
          <p className="mt-1 text-sm muted">Queue permitted sources and crawl targets.</p>
          <Link href="/sources" className="mt-2 inline-block text-sm underline">
            Manage sources →
          </Link>
        </div>
        <div className="card p-4">
          <h3 className="text-sm font-semibold">3 · Review</h3>
          <p className="mt-1 text-sm muted">Promote evidence-backed contacts into the CRM.</p>
          <Link href="/review" className="mt-2 inline-block text-sm underline">
            Review queue →
          </Link>
        </div>
      </section>
    </div>
  );
}
