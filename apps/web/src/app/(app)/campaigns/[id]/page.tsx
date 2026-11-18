import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@leadforge/database";
import { requireSession } from "@/lib/auth";
import { ActionButton } from "@/components/action-button";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;

  const campaign = await prisma.campaign.findFirst({
    where: { id, organizationId: session.organization.id },
  });
  if (!campaign) notFound();

  const [counts, recipients] = await Promise.all([
    prisma.campaignRecipient.groupBy({
      by: ["status"],
      where: { campaignId: campaign.id },
      _count: true,
    }),
    prisma.campaignRecipient.findMany({
      where: { campaignId: campaign.id },
      orderBy: { queuedAt: "asc" },
      take: 100,
      include: { email: { select: { status: true } } },
    }),
  ]);

  const countMap = Object.fromEntries(counts.map((c) => [c.status, c._count]));
  const scheduledAt = new Date(Date.now() + 5 * 60_000).toISOString();

  return (
    <div className="space-y-6">
      <header>
        <Link href="/campaigns" className="text-xs muted hover:underline">
          ← Campaigns
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
            <p className="mt-1 text-sm muted">{campaign.subject}</p>
          </div>
          <span className="badge badge-blue">{campaign.status}</span>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {["PENDING", "SENT", "EXCLUDED", "SUPPRESSED", "FAILED"].map((status) => (
          <div key={status} className="card p-3">
            <p className="text-xs uppercase tracking-wide muted">{status}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{countMap[status] ?? 0}</p>
          </div>
        ))}
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold">Actions</h2>
        <div className="flex flex-wrap gap-2">
          <ActionButton
            url={`/api/v1/campaigns/${campaign.id}/prepare`}
            label="Prepare recipients"
            pendingLabel="Evaluating…"
            variant="primary"
          />
          <ActionButton
            url={`/api/v1/campaigns/${campaign.id}/approve`}
            body={{ scheduledAt }}
            label="Approve + schedule"
            pendingLabel="Approving…"
            confirmText="Approve this campaign for sending? Every recipient is re-checked before delivery."
          />
          <ActionButton
            url={`/api/v1/campaigns/${campaign.id}/test-send`}
            label="Send test"
            pendingLabel="Sending…"
          />
          <ActionButton
            url={`/api/v1/campaigns/${campaign.id}/pause`}
            label="Pause / resume"
            pendingLabel="Toggling…"
          />
        </div>
        <p className="text-xs muted">
          Delivery stays in test mode while MAIL_ENABLED=false. The worker re-evaluates each
          recipient immediately before sending.
        </p>
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-[var(--lf-line)] px-4 py-3 text-sm font-semibold">
          Recipients ({recipients.length})
        </h2>
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Status</th>
              <th>Verification</th>
              <th>Reason / error</th>
              <th>Sent</th>
            </tr>
          </thead>
          <tbody>
            {recipients.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-sm muted">
                  No recipients yet. Run “Prepare recipients”.
                </td>
              </tr>
            ) : (
              recipients.map((recipient) => (
                <tr key={recipient.id}>
                  <td className="font-mono text-xs">{recipient.emailSnapshot}</td>
                  <td>
                    <span
                      className={`badge ${
                        recipient.status === "SENT"
                          ? "badge-green"
                          : recipient.status === "PENDING"
                            ? "badge-amber"
                            : "badge-red"
                      }`}
                    >
                      {recipient.status}
                    </span>
                  </td>
                  <td className="text-xs muted">{recipient.email.status}</td>
                  <td className="max-w-[22rem] truncate text-xs muted">{recipient.error ?? "—"}</td>
                  <td className="text-xs muted">
                    {recipient.sentAt ? recipient.sentAt.toISOString().slice(0, 16) : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-[var(--lf-line)] px-4 py-3 text-sm font-semibold">Body</h2>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-4 text-xs">
          {campaign.bodyHtml}
        </pre>
      </section>
    </div>
  );
}
