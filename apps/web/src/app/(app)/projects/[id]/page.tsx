import Link from "next/link";
import { prisma } from "@leadforge/database";
import { getProject, previewProject, projectResultWhere } from "@leadforge/pipeline";
import { requireSession } from "@/lib/auth";
import { Card, Confidence, Empty, PageHeader, formatDate } from "@/components/ui";
import { ProjectLive } from "@/components/project-live";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ strict?: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const { strict } = await searchParams;
  const project = await getProject(session.organization.id, id);
  const preview = await previewProject(session.organization.id, id);

  const strictWhere = strict === "1" ? await projectResultWhere(id) : {};
  const [results, total, strictCount] = await Promise.all([
    prisma.company.findMany({
      where: { organizationId: session.organization.id, deletedAt: null, projects: { some: { projectId: id } }, ...strictWhere },
      orderBy: { confidence: "desc" },
      take: 100,
      include: {
        domains: { where: { isPrimary: true }, include: { domain: { select: { domain: true } } } },
        locations: { take: 1, include: { city: { select: { name: true } } } },
        industries: { include: { industry: { select: { name: true } } }, orderBy: { isPrimary: "desc" }, take: 2 },
        _count: { select: { contacts: true, evidence: true } },
      },
    }),
    prisma.projectCompany.count({ where: { projectId: id } }),
    prisma.company.count({
      where: { organizationId: session.organization.id, deletedAt: null, projects: { some: { projectId: id } }, ...(await projectResultWhere(id)) },
    }),
  ]);

  const canApprove = ["ADMIN", "OWNER"].includes(session.role);
  const editable = !["RUNNING", "QUEUED"].includes(project.status);

  return (
    <div className="space-y-6">
      <PageHeader
        title={project.name}
        description={project.description ?? undefined}
        actions={
          <>
            {editable ? <Link href={`/projects/${id}/edit`} className="btn">Edit scope</Link> : null}
            <a href={`/api/v1/export/companies?projectId=${id}`} className="btn">Export companies</a>
            <a href={`/api/v1/export/contacts?projectId=${id}`} className="btn">Export contacts</a>
          </>
        }
      />

      <ProjectLive projectId={id} initialStatus={project.status} needsApproval={project.requiresApproval && !project.approvedAt} canApprove={canApprove} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Scope">
          <dl className="space-y-2 p-4 text-sm">
            <div><dt className="text-xs muted">Geography</dt><dd>{preview.scope.geography.join("; ")}</dd></div>
            {preview.scope.excludedGeography.length ? <div><dt className="text-xs muted">Excluded</dt><dd>{preview.scope.excludedGeography.join("; ")}</dd></div> : null}
            <div><dt className="text-xs muted">Industries</dt><dd>{preview.scope.industries.join("; ") || "Any"}</dd></div>
            {preview.scope.excludedIndustries.length ? <div><dt className="text-xs muted">Excluded industries</dt><dd>{preview.scope.excludedIndustries.join("; ")}</dd></div> : null}
            {preview.scope.keywords.length ? <div><dt className="text-xs muted">Keywords</dt><dd>{preview.scope.keywords.join(", ")}</dd></div> : null}
            <div><dt className="text-xs muted">Budget</dt><dd>{project.maxCompanies} companies · {project.maxPagesPerCompany} pages each · depth {project.maxCrawlDepth} · ≤ {preview.budget.maxRequests.toLocaleString("en")} requests</dd></div>
            <div><dt className="text-xs muted">Started / finished</dt><dd>{formatDate(project.startedAt)} / {formatDate(project.finishedAt)}</dd></div>
          </dl>
        </Card>
        <Card title="Sources and policy checks">
          <ul className="divide-y divide-[var(--lf-line)] text-sm">
            {preview.sources.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 px-4 py-2">
                <span>{s.name} <span className="text-xs muted">{s.adapter}</span></span>
                <span className={`badge ${s.usable ? "badge-green" : "badge-amber"}`}>{s.usable ? "usable" : s.policyStatus}</span>
              </li>
            ))}
          </ul>
          {preview.blockers.length || preview.warnings.length ? (
            <div className="space-y-1 border-t border-[var(--lf-line)] p-4 text-xs">
              {preview.blockers.map((b) => <p key={b} className="text-red-700">● {b}</p>)}
              {preview.warnings.map((w) => <p key={w} className="text-amber-800">● {w}</p>)}
            </div>
          ) : null}
        </Card>
      </div>

      <Card
        title={`Results — ${strict === "1" ? `${strictCount} meet every project filter` : `${total} discovered (${strictCount} meet every filter)`}`}
        actions={
          <Link className="text-xs underline" href={strict === "1" ? `/projects/${id}` : `/projects/${id}?strict=1`}>
            {strict === "1" ? "Show all discovered" : "Only records meeting every filter"}
          </Link>
        }
      >
        {results.length === 0 ? (
          <Empty>No companies yet. Results appear as source records are normalized and websites are crawled.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th>Company</th><th>City</th><th>Industry</th><th>Website</th><th>Contacts</th><th>Evidence</th><th>Confidence</th><th>Review</th></tr>
              </thead>
              <tbody>
                {results.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/companies/${c.id}`} className="font-medium hover:underline">{c.name}</Link></td>
                    <td className="text-xs">{c.locations[0]?.city?.name ?? c.locations[0]?.rawText ?? c.countryCode ?? "—"}</td>
                    <td className="text-xs">{c.industries.map((i) => i.industry.name).join("; ") || "unclassified"}</td>
                    <td className="font-mono text-xs">{c.domains[0]?.domain.domain ?? "—"}</td>
                    <td className="tabular-nums">{c._count.contacts}</td>
                    <td className="tabular-nums">{c._count.evidence}</td>
                    <td><Confidence value={c.confidence} /></td>
                    <td><span className="badge">{c.reviewStatus.replace("_", " ")}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > results.length ? (
          <p className="border-t border-[var(--lf-line)] px-4 py-2 text-xs muted">
            Showing the top {results.length}. <Link className="underline" href={`/companies?projectId=${id}`}>Open all in Companies</Link>.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
