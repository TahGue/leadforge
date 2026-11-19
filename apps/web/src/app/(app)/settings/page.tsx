import { prisma } from "@leadforge/database";
import { JURISDICTION_PROFILES } from "@leadforge/compliance";
import { features, limits, pingRedis, retention } from "@leadforge/pipeline";
import { requireSession } from "@/lib/auth";
import { ActionButton } from "@/components/action-button";
import { ApiKeyForm } from "@/components/api-key-form";
import { EraseForm } from "@/components/erase-form";
import { Card, KeyValue, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireSession();
  const isAdmin = ["ADMIN", "OWNER"].includes(session.role);
  const [apiKeys, approvals, redis, taxonomy, geoBatches] = await Promise.all([
    prisma.apiKey.count({ where: { organizationId: session.organization.id, revokedAt: null } }),
    features.campaigns ? prisma.jurisdictionProfile.findMany({ where: { status: "APPROVED" } }) : Promise.resolve([]),
    pingRedis(),
    prisma.industryTaxonomyVersion.findFirst({ where: { isCurrent: true } }),
    prisma.geoImportBatch.findMany({ orderBy: { importedAt: "desc" }, take: 5 }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Runtime configuration, reference data, integrations and privacy requests." />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Runtime">
          <KeyValue
            items={[
              ["Campaigns (Phase 9)", features.campaigns ? "enabled" : "frozen until legal review"],
              ["Redis / BullMQ", redis],
              ["Crawler user agent", process.env.CRAWLER_USER_AGENT ?? "set in crawler environment"],
              ["High-volume approval threshold", `${limits.highVolumeCompanies.toLocaleString("en")} companies`],
              ["Verification freshness", `${limits.verificationTtlDays} days`],
              ["Company freshness", `${limits.companyFreshnessDays} days`],
              ["Retention: rejected extractions", `${retention.rejectedCandidatesDays} days`],
              ["Retention: audit log", `${retention.auditDays} days`],
              ["Map style", process.env.NEXT_PUBLIC_MAP_STYLE_URL ? "configured" : "none (points only)"],
            ]}
          />
        </Card>
        <Card title="Reference data">
          <KeyValue
            items={[
              ["Industry taxonomy", taxonomy ? `${taxonomy.taxonomy} ${taxonomy.version}` : "not loaded"],
              ...geoBatches.map((b) => [`Geography: ${b.source}`, `${b.rowCount} rows · ${b.licence}`] as [string, string]),
            ]}
          />
          <p className="border-t border-[var(--lf-line)] px-4 py-2 text-xs muted">Import more geography with scripts/import-geonames.mjs (GeoNames, CC BY 4.0).</p>
        </Card>
        <Card title="Organization and API keys">
          <KeyValue items={[["Name", session.organization.name], ["Slug", session.organization.slug], ["Your role", session.role], ["Active API keys", apiKeys]]} />
          {isAdmin ? <div className="border-t border-[var(--lf-line)] p-4"><ApiKeyForm /></div> : null}
        </Card>
        {isAdmin ? (
          <Card title="Erasure request">
            <div className="space-y-2 p-4 text-sm">
              <p className="text-xs muted">Deletes a person&apos;s contact data and evidence. The address stays on the suppression list so it is never re-imported.</p>
              <EraseForm />
            </div>
          </Card>
        ) : null}
      </div>

      {features.campaigns ? (
        <Card title="Jurisdiction profiles">
          <table className="table">
            <thead><tr><th>Country</th><th>Regime</th><th>Status</th><th /></tr></thead>
            <tbody>
              {Object.values(JURISDICTION_PROFILES).map((profile) => {
                const approval = approvals.find((a) => a.code === profile.code);
                return (
                  <tr key={profile.code}>
                    <td className="font-medium">{profile.code}</td>
                    <td className="text-xs muted">{profile.regime}</td>
                    <td><span className={`badge ${approval ? "badge-green" : "badge-amber"}`}>{approval ? "APPROVED" : "DRAFT"}</span></td>
                    <td>
                      {approval || !isAdmin ? null : (
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
        </Card>
      ) : null}
    </div>
  );
}
