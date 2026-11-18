import { prisma } from "@leadforge/database";
import { JURISDICTION_PROFILES } from "@leadforge/compliance";
import { requireSession } from "@/lib/auth";
import { ActionButton } from "@/components/action-button";
import { ApiKeyForm } from "@/components/api-key-form";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireSession();

  const [approvals, apiKeys] = await Promise.all([
    prisma.jurisdictionProfile.findMany({ where: { status: "APPROVED" } }),
    prisma.apiKey.count({ where: { organizationId: session.organization.id, revokedAt: null } }),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm muted">Jurisdiction sign-off, delivery state and integrations.</p>
      </header>

      <section className="card overflow-hidden">
        <div className="border-b border-[var(--lf-line)] px-4 py-3">
          <h2 className="text-sm font-semibold">Jurisdiction profiles</h2>
          <p className="mt-1 text-xs muted">
            A country stays blocked until an admin records legal sign-off. Draft profiles deny by
            default.
          </p>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Country</th>
              <th>Regime</th>
              <th>Status</th>
              <th>Approved</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {Object.values(JURISDICTION_PROFILES).map((profile) => {
              const approval = approvals.find((a) => a.code === profile.code);
              return (
                <tr key={profile.code}>
                  <td className="font-medium">{profile.code}</td>
                  <td className="text-xs muted">{profile.regime}</td>
                  <td>
                    <span className={`badge ${approval ? "badge-green" : "badge-amber"}`}>
                      {approval ? "APPROVED" : "DRAFT"}
                    </span>
                  </td>
                  <td className="text-xs muted">
                    {approval?.approvedAt ? approval.approvedAt.toISOString().slice(0, 10) : "—"}
                  </td>
                  <td>
                    {approval ? null : (
                      <ActionButton
                        url={`/api/v1/jurisdictions/${profile.code}/approve`}
                        label="Approve"
                        confirmText={`Confirm that counsel reviewed ${profile.code} version ${profile.version} and approved marketing email there.`}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="card p-4">
          <h2 className="text-sm font-semibold">Delivery</h2>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="muted">Outbound mail</dt>
              <dd>
                <span className={`badge ${env.mailEnabled ? "badge-green" : "badge-amber"}`}>
                  {env.mailEnabled ? "ENABLED" : "TEST MODE"}
                </span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="muted">From address</dt>
              <dd className="font-mono text-xs">{env.smtp.from}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="muted">Postal address</dt>
              <dd>{env.postalAddress ? "configured" : "missing"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="muted">Test allowlist</dt>
              <dd>{env.mailTestAllowlist.length} address(es)</dd>
            </div>
          </dl>
        </div>

        <div className="card p-4">
          <h2 className="text-sm font-semibold">Organization</h2>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="muted">Name</dt>
              <dd>{session.organization.name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="muted">Slug</dt>
              <dd className="font-mono text-xs">{session.organization.slug}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="muted">Your role</dt>
              <dd>{session.role}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="muted">Active API keys</dt>
              <dd>{apiKeys}</dd>
            </div>
          </dl>
          <div className="mt-3">
            <ApiKeyForm />
          </div>
        </div>
      </section>
    </div>
  );
}
