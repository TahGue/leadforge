import Link from "next/link";
import { prisma } from "@leadforge/database";
import { limits } from "@leadforge/pipeline";
import { requireSession } from "@/lib/auth";
import { Card, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DataQualityPage() {
  const session = await requireSession();
  const org = session.organization.id;
  const base = { organizationId: org, deletedAt: null };
  const staleBefore = new Date(Date.now() - limits.companyFreshnessDays * 86_400_000);
  const [
    noDomain, noIndustry, noLocation, unresolvedLocation, lowConfidence, stale, needsReview, contactsNoEvidence, unverified, expired, pendingExtractions, openDuplicates, rejectReasons,
  ] = await Promise.all([
    prisma.company.count({ where: { ...base, domains: { none: {} } } }),
    prisma.company.count({ where: { ...base, industries: { none: {} } } }),
    prisma.company.count({ where: { ...base, locations: { none: {} } } }),
    prisma.companyLocation.count({ where: { resolution: { not: "RESOLVED" }, company: base } }),
    prisma.company.count({ where: { ...base, confidence: { lt: 0.5 } } }),
    prisma.company.count({ where: { ...base, lastSeenAt: { lt: staleBefore } } }),
    prisma.company.count({ where: { ...base, reviewStatus: "NEEDS_REVIEW" } }),
    prisma.contact.count({ where: { ...base, evidence: { none: {} }, sourceUrl: null } }),
    prisma.emailAddress.count({ where: { lastVerifiedAt: null, contacts: { some: { contact: { organizationId: org } } } } }),
    prisma.emailAddress.count({ where: { verificationExpiresAt: { lt: new Date() }, contacts: { some: { contact: { organizationId: org } } } } }),
    prisma.extractionCandidate.count({ where: { organizationId: org, status: "PENDING" } }),
    prisma.companyDuplicateCandidate.count({ where: { organizationId: org, status: "OPEN" } }),
    prisma.companyCandidate.groupBy({ by: ["rejectReason"], where: { organizationId: org, status: "REJECTED" }, _count: { _all: true } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Data quality" description="Missing fields, low-confidence and stale records, and everything waiting for a person." />
      <section>
        <h2 className="mb-2 text-sm font-semibold">Missing fields</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="No website domain" value={noDomain} />
          <Stat label="Unclassified industry" value={noIndustry} />
          <Stat label="No location" value={noLocation} />
          <Stat label="Unresolved locations" value={unresolvedLocation} hint="free text not matched to a city/region" />
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold">Confidence and freshness</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Low confidence (<50%)" value={lowConfidence} href="/companies?minConfidence=0" />
          <Stat label="Stale companies" value={stale} hint={`not observed in ${limits.companyFreshnessDays} days`} href="/companies?stale=true" />
          <Stat label="Never verified emails" value={unverified} />
          <Stat label="Verification expired" value={expired} hint="re-checked by the worker" />
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold">Human review</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Companies needing review" value={needsReview} href="/companies?reviewStatus=NEEDS_REVIEW" />
          <Stat label="Pending extractions" value={pendingExtractions} href="/review" />
          <Stat label="Open duplicates" value={openDuplicates} href="/duplicates" />
          <Stat label="Contacts without evidence" value={contactsNoEvidence} hint="should be zero" />
        </div>
      </section>
      <Card title="Why source records were rejected">
        <table className="table">
          <thead><tr><th>Reason</th><th>Records</th></tr></thead>
          <tbody>
            {rejectReasons.sort((a, b) => b._count._all - a._count._all).map((r) => (
              <tr key={r.rejectReason ?? "unknown"}><td>{(r.rejectReason ?? "unknown").replaceAll("_", " ")}</td><td className="tabular-nums">{r._count._all}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-[var(--lf-line)] px-4 py-2 text-xs muted">
          Rejected records stay for {process.env.RETENTION_STAGING_DAYS ?? 90} days for audit, then are purged. See <Link className="underline" href="/projects">projects</Link> for per-project detail.
        </p>
      </Card>
    </div>
  );
}
