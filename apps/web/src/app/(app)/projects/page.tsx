import Link from "next/link";
import { prisma, type ProjectStatus } from "@leadforge/database";
import { requireSession } from "@/lib/auth";
import { Card, Empty, PageHeader, StatusBadge, formatDate } from "@/components/ui";

export const dynamic = "force-dynamic";

const TABS: { key: string; label: string; statuses?: ProjectStatus[] }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active", statuses: ["RUNNING", "QUEUED", "PAUSED"] },
  { key: "ready", label: "Not started", statuses: ["DRAFT", "READY"] },
  { key: "done", label: "Completed", statuses: ["COMPLETED", "FAILED", "CANCELLED"] },
];

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await requireSession();
  const { tab = "all" } = await searchParams;
  const current = TABS.find((t) => t.key === tab) ?? TABS[0]!;
  const projects = await prisma.discoveryProject.findMany({
    where: { organizationId: session.organization.id, ...(current.statuses ? { status: { in: current.statuses } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      _count: { select: { companies: true, crawlJobs: true } },
      locations: { take: 3, include: { country: { select: { name: true } }, city: { select: { name: true } }, region: { select: { name: true } } } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discovery projects"
        description="Each project discovers companies in a geography and industry scope from permitted sources, then crawls their websites for evidence-backed business contacts."
        actions={<Link href="/projects/new" className="btn btn-primary">New project</Link>}
      />
      <nav className="flex gap-1 text-sm">
        {TABS.map((t) => (
          <Link key={t.key} href={`/projects?tab=${t.key}`} className={`rounded-md px-3 py-1 ${t.key === current.key ? "bg-[var(--lf-ink)] text-white" : "hover:bg-[#f1f1ee]"}`}>
            {t.label}
          </Link>
        ))}
      </nav>
      <Card>
        {projects.length === 0 ? (
          <Empty>No projects here.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Project</th><th>Scope</th><th>Status</th><th>Companies</th><th>Crawls</th><th>Created</th></tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.name}</Link></td>
                  <td className="text-xs muted">
                    {p.geographicMode === "WORLDWIDE" || p.locations.length === 0
                      ? "Worldwide"
                      : p.locations.map((l) => l.city?.name ?? l.region?.name ?? l.country?.name ?? l.continentCode ?? l.postalPrefix).join(", ")}
                  </td>
                  <td><StatusBadge status={p.status} /></td>
                  <td className="tabular-nums">{p._count.companies} / {p.maxCompanies}</td>
                  <td className="tabular-nums">{p._count.crawlJobs}</td>
                  <td className="text-xs muted">{formatDate(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
