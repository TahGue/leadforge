import { prisma } from "@leadforge/database";
import { requireSession } from "@/lib/auth";
import { SuppressionForm } from "@/components/suppression-form";

export const dynamic = "force-dynamic";

export default async function SuppressionsPage() {
  const session = await requireSession();

  const entries = await prisma.suppressionEntry.findMany({
    where: { OR: [{ organizationId: session.organization.id }, { organizationId: null }] },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Suppressions</h1>
        <p className="mt-1 text-sm muted">
          Global entries (unsubscribe, complaint, hard bounce) apply to every campaign. Suppression
          is checked when a list is built and again immediately before each send.
        </p>
      </header>

      <SuppressionForm />

      <div className="card overflow-hidden">
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Reason</th>
              <th>Scope</th>
              <th>Source</th>
              <th>Added</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-10 text-center text-sm muted">
                  No suppressed addresses.
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="font-mono text-xs">{entry.emailNormalized}</td>
                  <td>
                    <span className="badge badge-red">{entry.reason}</span>
                  </td>
                  <td className="text-xs muted">{entry.organizationId ? "Organization" : "Global"}</td>
                  <td className="text-xs muted">{entry.source ?? "—"}</td>
                  <td className="text-xs muted">{entry.createdAt.toISOString().slice(0, 10)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
