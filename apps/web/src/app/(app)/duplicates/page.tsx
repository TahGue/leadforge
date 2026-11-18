import Link from "next/link";
import { prisma } from "@leadforge/database";
import { requireSession } from "@/lib/auth";
import { ActionButton } from "@/components/action-button";
import { Card, Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const select = {
  id: true,
  name: true,
  countryCode: true,
  registrationNumber: true,
  createdAt: true,
  domains: { include: { domain: { select: { domain: true } } } },
  _count: { select: { contacts: true, evidence: true } },
} as const;

export default async function DuplicatesPage() {
  const session = await requireSession();
  const pairs = await prisma.companyDuplicateCandidate.findMany({
    where: { organizationId: session.organization.id, status: "OPEN" },
    orderBy: { score: "desc" },
    take: 100,
    include: { companyA: { select }, companyB: { select } },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Duplicate review"
        description="LeadForge merges automatically only on the same domain or registration number. Similar names and shared phone numbers are listed here for a person to decide."
        actions={<ActionButton url="/api/v1/duplicates" label="Scan for duplicates" />}
      />
      <Card>
        {pairs.length === 0 ? <Empty>No open duplicate candidates.</Empty> : (
          <ul className="divide-y divide-[var(--lf-line)]">
            {pairs.map((pair) => (
              <li key={pair.id} className="grid gap-3 p-4 md:grid-cols-[1fr_1fr_auto]">
                {[pair.companyA, pair.companyB].map((c, index) => (
                  <div key={c.id} className="text-sm">
                    <p className="text-xs muted">{index === 0 ? "A" : "B"}</p>
                    <Link className="font-medium hover:underline" href={`/companies/${c.id}`}>{c.name}</Link>
                    <p className="text-xs muted">
                      {c.countryCode ?? "—"} · {c.domains.map((d) => d.domain.domain).join(", ") || "no domain"} · reg {c.registrationNumber ?? "—"} · {c._count.contacts} contacts · {c._count.evidence} evidence
                    </p>
                  </div>
                ))}
                <div className="flex flex-col items-start gap-1 text-xs">
                  <span className="muted">
                    score {Math.round(pair.score * 100)}% · {(pair.signals as { signal: string }[]).map((s) => s.signal).join(", ")}
                  </span>
                  <ActionButton url={`/api/v1/duplicates/${pair.id}`} body={{ action: "MERGE", keep: "A" }} label="Merge into A" confirmText="Merge B into A? B is archived and its contacts, evidence and projects move to A." />
                  <ActionButton url={`/api/v1/duplicates/${pair.id}`} body={{ action: "MERGE", keep: "B" }} label="Merge into B" confirmText="Merge A into B?" />
                  <ActionButton url={`/api/v1/duplicates/${pair.id}`} body={{ action: "DISMISS" }} label="Not duplicates" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
