import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@leadforge/database";
import { requireSession } from "@/lib/auth";
import { ActionButton } from "@/components/action-button";
import { Card, Confidence, Empty, KeyValue, PageHeader, StatusBadge, formatDate } from "@/components/ui";

export const dynamic = "force-dynamic";

interface Component { name: string; value: number; weight: number; reason: string }

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const company = await prisma.company.findFirst({
    where: { id, organizationId: session.organization.id, deletedAt: null },
    include: {
      domains: { include: { domain: true } },
      locations: { include: { city: true, region: true, country: { select: { name: true } }, source: { select: { name: true } } } },
      industries: { include: { industry: { select: { code: true, name: true } } }, orderBy: { isPrimary: "desc" } },
      contacts: {
        where: { deletedAt: null },
        orderBy: [{ category: "asc" }, { confidence: "desc" }],
        include: {
          emails: { include: { email: { include: { verifications: { orderBy: { checkedAt: "desc" }, take: 1 } } } } },
          evidence: { orderBy: { observedAt: "desc" }, take: 1 },
        },
      },
      evidence: { orderBy: { observedAt: "desc" }, take: 30, include: { source: { select: { name: true } } } },
      observations: { orderBy: { observedAt: "desc" }, take: 60, include: { source: { select: { name: true, licenceName: true } } } },
      projects: { include: { project: { select: { id: true, name: true } } } },
      crawlJobs: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  if (!company) notFound();
  const components = ((company.confidenceDetail as { components?: Component[] } | null)?.components ?? []) as Component[];
  const technologies = (company.technologies as string[] | null) ?? [];
  const socials = (company.socialProfiles as string[] | null) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={company.name}
        description={
          <>
            {company.countryCode ?? "country unknown"} · {company.industries.map((i) => i.industry.name).join("; ") || "unclassified"} ·{" "}
            <StatusBadge status={company.reviewStatus} />
          </>
        }
        actions={
          <>
            <ActionButton url={`/api/v1/companies/${company.id}/crawl`} label="Crawl website" />
            <ActionButton url={`/api/v1/companies/${company.id}`} method="PATCH" body={{ reviewStatus: "REVIEWED" }} label="Mark reviewed" />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Profile">
          <KeyValue
            items={[
              ["Website", company.website ? <a className="underline" href={company.website} rel="noreferrer noopener" target="_blank">{company.website}</a> : null],
              ["Domains", company.domains.map((d) => d.domain.domain).join(", ") || null],
              ["Registration no.", company.registrationNumber],
              ["Legal form", company.legalForm],
              ["Employees (sourced estimate)", company.employeeRange],
              ["Founded", company.foundedYear],
              ["Website status", company.websiteStatus],
              ["HTTPS", company.httpsEnabled === null ? null : company.httpsEnabled ? "yes" : "no"],
              ["Language", company.primaryLanguage],
              ["Technologies (heuristic)", technologies.join(", ") || null],
              ["Social profiles", socials.length ? socials.length : null],
              ["Tags", company.tags.join(", ") || null],
              ["First seen / last observed", `${formatDate(company.firstSeenAt)} / ${formatDate(company.lastSeenAt)}`],
            ]}
          />
        </Card>
        <Card title="Confidence">
          <div className="space-y-2 p-4 text-sm">
            <Confidence value={company.confidence} />
            {components.length ? (
              <ul className="space-y-1 text-xs">
                {components.map((c) => (
                  <li key={c.name} className="flex justify-between gap-2">
                    <span className="muted">{c.reason}</span>
                    <span className="tabular-nums">{Math.round(c.value * 100)}% × {c.weight}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs muted">No score breakdown yet.</p>}
            <p className="text-xs muted">A ranking aid built from named components, not objective truth.</p>
          </div>
        </Card>
        <Card title="Locations and industries">
          <ul className="divide-y divide-[var(--lf-line)] text-sm">
            {company.locations.map((l) => (
              <li key={l.id} className="px-4 py-2">
                <p>{[l.addressLine, l.postalCode, l.city?.name, l.region?.name, l.country?.name].filter(Boolean).join(", ") || l.rawText || "—"}</p>
                <p className="text-xs muted">{l.locationType.toLowerCase()} · {l.resolution.toLowerCase()} · {Math.round(l.confidence * 100)}%{l.source ? ` · ${l.source.name}` : ""}</p>
              </li>
            ))}
            {company.industries.map((i) => (
              <li key={i.id} className="px-4 py-2">
                <p>{i.industry.name}{i.isPrimary ? " (primary)" : ""}</p>
                <p className="text-xs muted">{i.method.toLowerCase()} · {Math.round(i.confidence * 100)}%{i.evidence ? ` · ${i.evidence}` : ""}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title={`Contacts (${company.contacts.length})`}>
        {company.contacts.length === 0 ? (
          <Empty>No contacts yet. Crawl the website to extract evidence-backed contact details.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Contact</th><th>Category</th><th>Email status</th><th>Source</th><th>Confidence</th><th /></tr>
            </thead>
            <tbody>
              {company.contacts.map((c) => {
                const email = c.emails[0]?.email;
                const check = email?.verifications[0];
                const source = c.evidence[0]?.pageUrl ?? c.sourceUrl;
                return (
                  <tr key={c.id}>
                    <td className="text-xs">
                      {email ? <p className="font-mono">{email.normalized}</p> : null}
                      {c.phoneE164 ?? c.phoneRaw ? <p className="font-mono">{c.phoneE164 ?? c.phoneRaw}</p> : null}
                      {c.contactFormUrl ? <a className="underline" href={c.contactFormUrl} rel="noreferrer noopener" target="_blank">contact form</a> : null}
                      {c.fullName ? <p>{c.fullName}{c.jobTitle ? ` · ${c.jobTitle}` : ""}</p> : null}
                    </td>
                    <td><span className="badge">{c.category}</span>{c.isRoleBased ? <span className="ml-1 text-xs muted">role</span> : null}</td>
                    <td className="text-xs">
                      <StatusBadge status={email?.status} />
                      {check ? <p className="muted">syntax {check.syntaxStatus.toLowerCase()} · mx {check.mxStatus.toLowerCase()}</p> : null}
                    </td>
                    <td className="max-w-[16rem] truncate text-xs">{source ? <a className="underline" href={source} rel="noreferrer noopener" target="_blank">{source}</a> : "—"}</td>
                    <td><Confidence value={c.confidence} /></td>
                    <td><ActionButton url={`/api/v1/contacts/${c.id}/verify`} label="Verify" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Source observations">
          {company.observations.length === 0 ? <Empty>No source observations.</Empty> : (
            <table className="table">
              <thead><tr><th>Field</th><th>Value</th><th>Source</th><th>Observed</th></tr></thead>
              <tbody>
                {company.observations.map((o) => (
                  <tr key={o.id}>
                    <td className="text-xs">{o.fieldName}</td>
                    <td className="max-w-[14rem] truncate text-xs" title={o.fieldValue}>{o.fieldValue}</td>
                    <td className="text-xs">{o.sourceUrl ? <a className="underline" href={o.sourceUrl} rel="noreferrer noopener" target="_blank">{o.source.name}</a> : o.source.name}{o.licence ? <span className="muted"> · {o.licence}</span> : null}</td>
                    <td className="text-xs muted">{formatDate(o.observedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Page evidence">
          {company.evidence.length === 0 ? <Empty>No page evidence.</Empty> : (
            <table className="table">
              <thead><tr><th>Field</th><th>Value</th><th>Method</th><th>Page</th></tr></thead>
              <tbody>
                {company.evidence.map((e) => (
                  <tr key={e.id}>
                    <td className="text-xs">{e.fieldName}</td>
                    <td className="max-w-[12rem] truncate font-mono text-xs" title={e.snippet ?? e.extractedValue}>{e.extractedValue}</td>
                    <td className="text-xs">{e.method}</td>
                    <td className="max-w-[12rem] truncate text-xs"><a className="underline" href={e.pageUrl} rel="noreferrer noopener" target="_blank">{e.pageUrl}</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card title="Projects and crawls">
        <div className="space-y-2 p-4 text-sm">
          <p>{company.projects.map((p) => <Link key={p.projectId} className="mr-3 underline" href={`/projects/${p.projectId}`}>{p.project.name}</Link>)}</p>
          <ul className="text-xs">
            {company.crawlJobs.map((j) => (
              <li key={j.id}>
                <Link className="underline" href={`/jobs?job=${j.id}`}>{formatDate(j.createdAt)}</Link> <StatusBadge status={j.status} /> {j.pagesFetched} pages{j.policyStopReason ? ` · ${j.policyStopReason}` : ""}{j.errorMessage ? ` · ${j.errorMessage}` : ""}
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </div>
  );
}
