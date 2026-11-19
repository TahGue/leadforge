import { notFound } from "next/navigation";
import { features } from "@leadforge/pipeline";
import Link from "next/link";
import { prisma } from "@leadforge/database";
import { requireSession } from "@/lib/auth";
import { CampaignCreateForm } from "@/components/campaign-forms";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  if (!features.campaigns) notFound();
  const session = await requireSession();

  const campaigns = await prisma.campaign.findMany({
    where: { organizationId: session.organization.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { recipients: true } } },
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
        <p className="mt-1 text-sm muted">
          Every recipient is re-evaluated before it is queued. Nothing is sent by default:
          <span className="font-medium"> MAIL_ENABLED=false</span> keeps delivery in test mode.
        </p>
      </header>

      <CampaignCreateForm />

      <div className="card overflow-hidden">
        <table className="table">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Status</th>
              <th>Recipients</th>
              <th>Basis</th>
              <th>Scheduled</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-10 text-center text-sm muted">
                  No campaigns yet.
                </td>
              </tr>
            ) : (
              campaigns.map((campaign) => (
                <tr key={campaign.id}>
                  <td>
                    <Link href={`/campaigns/${campaign.id}`} className="font-medium hover:underline">
                      {campaign.name}
                    </Link>
                    <p className="text-xs muted">{campaign.subject}</p>
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        campaign.status === "SCHEDULED" || campaign.status === "RUNNING"
                          ? "badge-blue"
                          : campaign.status === "COMPLETED"
                            ? "badge-green"
                            : campaign.status === "PAUSED"
                              ? "badge-amber"
                              : ""
                      }`}
                    >
                      {campaign.status}
                    </span>
                  </td>
                  <td className="tabular-nums">{campaign._count.recipients}</td>
                  <td className="text-xs muted">{campaign.lawfulBasis ?? "—"}</td>
                  <td className="text-xs muted">
                    {campaign.scheduledAt ? campaign.scheduledAt.toISOString().slice(0, 16) : "—"}
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
