import { prisma } from "@leadforge/database";
import { requireSession } from "@/lib/auth";
import { SourceCreateForm, SourceApproveButton } from "@/components/source-forms";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const session = await requireSession();

  const sources = await prisma.source.findMany({
    where: { organizationId: session.organization.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { crawlTargets: true } } },
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Sources</h1>
        <p className="mt-1 text-sm muted">
          Collection is blocked until a human records the terms review. Approved sources are the
          only ones the crawler will touch.
        </p>
      </header>

      <SourceCreateForm />

      <div className="card overflow-hidden">
        <table className="table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Type</th>
              <th>Policy</th>
              <th>Targets</th>
              <th>Reviewed</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sources.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-sm muted">
                  No sources registered yet.
                </td>
              </tr>
            ) : (
              sources.map((source) => (
                <tr key={source.id}>
                  <td>
                    <p className="font-medium">{source.name}</p>
                    <p className="text-xs muted">{source.baseUrl ?? "—"}</p>
                  </td>
                  <td className="text-xs muted">{source.sourceType}</td>
                  <td>
                    <span className={`badge ${source.permitted ? "badge-green" : "badge-amber"}`}>
                      {source.permitted ? "PERMITTED" : "BLOCKED"}
                    </span>
                  </td>
                  <td className="tabular-nums">{source._count.crawlTargets}</td>
                  <td className="text-xs muted">
                    {source.tosReviewedAt ? source.tosReviewedAt.toISOString().slice(0, 10) : "—"}
                  </td>
                  <td>
                    {source.permitted ? null : (
                      <SourceApproveButton
                        sourceId={source.id}
                        tosUrl={source.tosUrl ?? ""}
                        hasTos={Boolean(source.tosUrl)}
                      />
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
