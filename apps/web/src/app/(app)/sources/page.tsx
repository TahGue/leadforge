import { prisma } from "@leadforge/database";
import { requireSession } from "@/lib/auth";
import { Card, Empty, PageHeader, StatusBadge, formatDate } from "@/components/ui";
import { SourceCreateForm } from "@/components/source-forms";
import { SourcePolicyForm } from "@/components/source-policy-form";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const session = await requireSession();
  const sources = await prisma.source.findMany({
    where: { organizationId: session.organization.id },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { crawlJobs: true, discoveryRuns: true, observations: true } } },
  });
  const isAdmin = ["ADMIN", "OWNER"].includes(session.role);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Source registry"
        description="Every source declares its terms, licence, permitted use, rate limit and retention. A source cannot be used for discovery until a person approves its policy; changing the policy bumps its version."
      />
      <Card>
        {sources.length === 0 ? <Empty>No sources.</Empty> : (
          <ul className="divide-y divide-[var(--lf-line)]">
            {sources.map((s) => {
              const rate = (s.rateLimitJson as { requestsPerMinute?: number } | null)?.requestsPerMinute ?? null;
              return (
                <li key={s.id} className="p-4 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {s.name} <StatusBadge status={s.policyStatus} /> {s.enabled ? null : <span className="badge">disabled</span>}
                      </p>
                      <p className="text-xs muted">
                        {s.sourceType} · adapter {s.adapter ?? "none"} · policy v{s.policyVersion} · reviewed {formatDate(s.tosReviewedAt)}
                      </p>
                      <p className="mt-1 text-xs">
                        {s.licenceName ? <>Licence {s.licenceUrl ? <a className="underline" href={s.licenceUrl} rel="noreferrer noopener" target="_blank">{s.licenceName}</a> : s.licenceName} · </> : null}
                        {s.tosUrl ? <a className="underline" href={s.tosUrl} rel="noreferrer noopener" target="_blank">terms</a> : "no terms URL"} · automated access {s.automatedAccessAllowed ? "allowed" : "not confirmed"} · commercial reuse {s.commercialReuseAllowed ? "allowed" : "not confirmed"}
                        {rate ? ` · ${rate} req/min` : ""}{s.retentionDays ? ` · retain ${s.retentionDays} d` : ""}
                      </p>
                      {s.attribution ? <p className="text-xs muted">Attribution: {s.attribution}</p> : null}
                      {s.policyNotes ? <p className="mt-1 max-w-3xl text-xs muted">{s.policyNotes}</p> : null}
                    </div>
                    <p className="text-xs muted">{s._count.discoveryRuns} runs · {s._count.observations} observations · {s._count.crawlJobs} crawls</p>
                  </div>
                  {isAdmin ? (
                    <SourcePolicyForm
                      source={{
                        id: s.id,
                        name: s.name,
                        sourceType: s.sourceType,
                        policyStatus: s.policyStatus,
                        enabled: s.enabled,
                        tosUrl: s.tosUrl,
                        licenceName: s.licenceName,
                        licenceUrl: s.licenceUrl,
                        permittedUse: s.permittedUse,
                        attribution: s.attribution,
                        policyNotes: s.policyNotes,
                        automatedAccessAllowed: s.automatedAccessAllowed,
                        commercialReuseAllowed: s.commercialReuseAllowed,
                        retentionDays: s.retentionDays,
                        requestsPerMinute: rate,
                      }}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {isAdmin ? <SourceCreateForm /> : null}
    </div>
  );
}
