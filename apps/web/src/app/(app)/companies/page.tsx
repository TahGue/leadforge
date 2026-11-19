import Link from "next/link";
import { prisma, type Prisma } from "@leadforge/database";
import { companyWhere } from "@leadforge/pipeline";
import { companyListQuery, decodeCursor, encodeCursor } from "@leadforge/shared";
import { requireSession } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { CompaniesTable, type CompanyRow } from "@/components/companies-table";
import { CompanyCreateForm, CompanyImportForm } from "@/components/company-forms";

export const dynamic = "force-dynamic";

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const raw = await searchParams;
  const parsed = companyListQuery.safeParse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v)));
  const query = parsed.success ? parsed.data : companyListQuery.parse({});
  const where = await companyWhere(session.organization.id, query);
  if (query.cursor) {
    const c = decodeCursor<{ t: string; id: string }>(query.cursor);
    (where.AND as Prisma.CompanyWhereInput[]).push({ OR: [{ updatedAt: { lt: new Date(c.t) } }, { updatedAt: new Date(c.t), id: { lt: c.id } }] });
  }

  const [rows, total, version, countries, segments] = await Promise.all([
    prisma.company.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      include: {
        domains: { where: { isPrimary: true }, include: { domain: { select: { domain: true } } } },
        locations: { take: 1, orderBy: { isHeadquarters: "desc" }, include: { city: { select: { name: true } } } },
        industries: { include: { industry: { select: { name: true } } }, orderBy: { isPrimary: "desc" } },
        _count: { select: { contacts: true, evidence: true } },
      },
    }),
    prisma.company.count({ where }),
    prisma.industryTaxonomyVersion.findFirst({ where: { isCurrent: true } }),
    prisma.company.groupBy({ by: ["countryCode"], where: { organizationId: session.organization.id, deletedAt: null }, _count: { _all: true } }),
    prisma.savedSegment.findMany({ where: { organizationId: session.organization.id, entity: "COMPANIES" }, orderBy: { name: "asc" } }),
  ]);
  const sectors = version
    ? await prisma.industry.findMany({ where: { versionId: version.id, parentId: null }, orderBy: { name: "asc" }, select: { id: true, name: true } })
    : [];

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];
  const next = hasMore && last ? encodeCursor({ t: last.updatedAt.toISOString(), id: last.id }) : null;

  const data: CompanyRow[] = page.map((c) => ({
    id: c.id,
    name: c.name,
    domain: c.domains[0]?.domain.domain ?? null,
    country: c.countryCode,
    city: c.locations[0]?.city?.name ?? c.locations[0]?.rawText ?? null,
    industries: c.industries.map((i) => i.industry.name),
    employeeRange: c.employeeRange,
    contacts: c._count.contacts,
    evidence: c._count.evidence,
    confidence: c.confidence,
    lastSeenAt: c.lastSeenAt.toISOString(),
    reviewStatus: c.reviewStatus,
    tags: c.tags,
  }));

  const filterParams = new URLSearchParams(Object.entries(raw).filter(([k, v]) => v && k !== "cursor") as [string, string][]);
  const exportHref = `/api/v1/export/companies?${filterParams}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Companies"
        description={`${total.toLocaleString("en")} companies match. Every field keeps its source, observation time and confidence.`}
        actions={<a href={exportHref} className="btn">Export CSV</a>}
      />

      <form className="card grid gap-2 p-3 text-sm md:grid-cols-6" method="get">
        <input name="q" defaultValue={query.q} placeholder="Search name, description, domain" className="input md:col-span-2" />
        <select name="country" defaultValue={query.country ?? ""} className="input">
          <option value="">Any country</option>
          {countries.filter((c) => c.countryCode).map((c) => (
            <option key={c.countryCode} value={c.countryCode!}>{c.countryCode} ({c._count._all})</option>
          ))}
        </select>
        <select name="industryId" defaultValue={query.industryId ?? ""} className="input">
          <option value="">Any industry</option>
          {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select name="reviewStatus" defaultValue={query.reviewStatus ?? ""} className="input">
          <option value="">Any review state</option>
          <option value="UNREVIEWED">Unreviewed</option>
          <option value="NEEDS_REVIEW">Needs review</option>
          <option value="REVIEWED">Reviewed</option>
        </select>
        <select name="hasContacts" defaultValue={query.hasContacts ?? ""} className="input">
          <option value="">Contacts: any</option>
          <option value="true">With contacts</option>
          <option value="false">Without contacts</option>
        </select>
        <input name="tag" defaultValue={query.tag} placeholder="Tag" className="input" />
        <input name="minConfidence" defaultValue={query.minConfidence?.toString()} placeholder="Min confidence 0–1" className="input" />
        <select name="stale" defaultValue={query.stale ?? ""} className="input">
          <option value="">Fresh or stale</option>
          <option value="true">Stale only</option>
        </select>
        {query.projectId ? <input type="hidden" name="projectId" value={query.projectId} /> : null}
        {query.cityId ? <input type="hidden" name="cityId" value={query.cityId} /> : null}
        <div className="flex gap-2 md:col-span-3">
          <button type="submit" className="btn btn-primary">Filter</button>
          <Link href="/companies" className="btn">Reset</Link>
        </div>
      </form>

      {segments.length ? (
        <p className="text-xs">
          <span className="muted">Saved views:</span>{" "}
          {segments.map((s) => (
            <Link key={s.id} className="mr-3 underline" href={`/companies?${new URLSearchParams(s.filters as Record<string, string>)}`}>{s.name}</Link>
          ))}
        </p>
      ) : null}

      <Card>
        <CompaniesTable rows={data} />
        <div className="flex justify-between border-t border-[var(--lf-line)] px-4 py-2 text-xs">
          <span className="muted">{page.length} shown</span>
          {next ? <Link className="underline" href={`/companies?${new URLSearchParams({ ...Object.fromEntries(filterParams), cursor: next })}`}>Next page →</Link> : null}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <CompanyCreateForm />
        <CompanyImportForm />
      </div>
    </div>
  );
}
