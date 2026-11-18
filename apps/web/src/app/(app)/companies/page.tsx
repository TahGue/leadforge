import Link from "next/link";
import { prisma } from "@leadforge/database";
import { requireSession } from "@/lib/auth";
import { CompanyCreateForm, CompanyImportForm } from "@/components/company-forms";

export const dynamic = "force-dynamic";

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireSession();
  const { q } = await searchParams;

  const companies = await prisma.company.findMany({
    where: {
      organizationId: session.organization.id,
      deletedAt: null,
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      domains: { include: { domain: true } },
      _count: { select: { contacts: true } },
    },
  });

  const total = await prisma.company.count({
    where: { organizationId: session.organization.id, deletedAt: null },
  });

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
          <p className="mt-1 text-sm muted">
            {total.toLocaleString()} companies · {companies.length} shown
          </p>
        </div>
        <form action="/companies" className="flex gap-2">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search companies"
            className="input w-56"
          />
          <button type="submit" className="btn">
            Search
          </button>
        </form>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <CompanyCreateForm />
        <CompanyImportForm />
      </div>

      <div className="card overflow-hidden">
        <table className="table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Domain</th>
              <th>Country</th>
              <th>Industry</th>
              <th>Contacts</th>
            </tr>
          </thead>
          <tbody>
            {companies.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-sm muted">
                  No companies yet. Add one manually or import a CSV.
                </td>
              </tr>
            ) : (
              companies.map((company) => (
                <tr key={company.id}>
                  <td>
                    <Link href={`/companies/${company.id}`} className="font-medium hover:underline">
                      {company.name}
                    </Link>
                  </td>
                  <td className="font-mono text-xs">
                    {company.domains[0]?.domain.domain ?? "—"}
                  </td>
                  <td>{company.countryCode ?? "—"}</td>
                  <td className="muted">{company.industry ?? "—"}</td>
                  <td className="tabular-nums">{company._count.contacts}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
