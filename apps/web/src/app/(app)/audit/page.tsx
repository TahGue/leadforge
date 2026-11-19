import { prisma } from "@leadforge/database";
import { requireSession } from "@/lib/auth";
import { Card, Empty, PageHeader, formatDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  const session = await requireSession();
  const { action } = await searchParams;
  const entries = await prisma.auditLog.findMany({
    where: { organizationId: session.organization.id, ...(action ? { action: { startsWith: action } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { actor: { select: { email: true } } },
  });
  return (
    <div className="space-y-6">
      <PageHeader title="Audit log" description="Privileged and data-changing actions: imports, source approvals, project lifecycle, merges, exports, verification, suppression and erasure." />
      <form method="get" className="flex gap-2">
        <input name="action" defaultValue={action} placeholder="Filter by action prefix, e.g. source." className="input max-w-sm" />
        <button className="btn" type="submit">Filter</button>
      </form>
      <Card>
        {entries.length === 0 ? <Empty>No entries.</Empty> : (
          <table className="table">
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-xs muted">{formatDate(e.createdAt)}</td>
                  <td className="text-xs">{e.actor?.email ?? (e.metadata as { actor?: string } | null)?.actor ?? "system"}</td>
                  <td className="font-mono text-xs">{e.action}</td>
                  <td className="text-xs">{e.entity}{e.entityId ? <span className="muted"> {e.entityId.slice(0, 10)}</span> : null}</td>
                  <td className="max-w-[28rem] truncate font-mono text-[11px] muted" title={JSON.stringify(e.metadata)}>{JSON.stringify(e.metadata)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
