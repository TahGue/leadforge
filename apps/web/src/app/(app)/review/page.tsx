import { prisma } from "@leadforge/database";
import { requireSession } from "@/lib/auth";
import { ActionButton } from "@/components/action-button";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const session = await requireSession();

  const [candidates, counts] = await Promise.all([
    prisma.extractionCandidate.findMany({
      where: { organizationId: session.organization.id, status: "PENDING" },
      orderBy: [{ confidence: "desc" }, { createdAt: "asc" }],
      take: 100,
      include: {
        company: { select: { id: true, name: true, countryCode: true } },
        artifact: { select: { url: true, fetchedAt: true } },
      },
    }),
    prisma.extractionCandidate.groupBy({
      by: ["status"],
      where: { organizationId: session.organization.id },
      _count: true,
    }),
  ]);

  const countMap = Object.fromEntries(counts.map((c) => [c.status, c._count]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
        <p className="mt-1 text-sm muted">
          {countMap.PENDING ?? 0} pending · {countMap.PROMOTED ?? 0} promoted ·{" "}
          {countMap.REJECTED ?? 0} rejected. Nothing reaches a campaign without promotion.
        </p>
      </header>

      <div className="card overflow-hidden">
        {candidates.length === 0 ? (
          <p className="px-4 py-10 text-sm muted">
            Queue is empty. Run the crawler worker against a discovery project to produce candidates.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Value</th>
                <th>Company</th>
                <th>Method</th>
                <th>Confidence</th>
                <th>Source</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => (
                <tr key={candidate.id}>
                  <td className="font-mono text-xs">{candidate.normalizedValue}</td>
                  <td>
                    {candidate.company?.name ?? "—"}
                    {candidate.company?.countryCode ? (
                      <span className="ml-1 text-xs muted">{candidate.company.countryCode}</span>
                    ) : null}
                  </td>
                  <td className="text-xs muted">{candidate.method}</td>
                  <td className="tabular-nums">{candidate.confidence.toFixed(2)}</td>
                  <td className="max-w-[20rem] truncate text-xs muted">
                    {candidate.artifact.url}
                  </td>
                  <td>
                    <div className="flex gap-2">
                      <ActionButton
                        url={`/api/v1/candidates/${candidate.id}`}
                        body={{ action: "PROMOTE" }}
                        label="Promote"
                        variant="primary"
                        pendingLabel="Saving…"
                      />
                      <ActionButton
                        url={`/api/v1/candidates/${candidate.id}`}
                        body={{ action: "REJECT", reason: "manual rejection" }}
                        label="Reject"
                        variant="danger"
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
