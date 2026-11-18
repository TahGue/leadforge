import { prisma } from "@leadforge/database";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { Explorer } from "@/components/explorer";

export const dynamic = "force-dynamic";

export default async function ExplorerPage() {
  const session = await requireSession();
  const org = session.organization.id;

  const [continents, countries, countryCounts, cities, cityCounts, version] = await Promise.all([
    prisma.continent.findMany({ orderBy: { name: "asc" } }),
    prisma.country.findMany({ orderBy: { name: "asc" }, select: { iso2: true, name: true, continentCode: true } }),
    prisma.company.groupBy({ by: ["countryCode"], where: { organizationId: org, deletedAt: null }, _count: { _all: true } }),
    prisma.city.findMany({
      orderBy: [{ population: "desc" }],
      take: 3000,
      select: { id: true, name: true, countryIso2: true, latitude: true, longitude: true, region: { select: { name: true } } },
    }),
    prisma.companyLocation.groupBy({
      by: ["cityId"],
      where: { cityId: { not: null }, company: { organizationId: org, deletedAt: null } },
      _count: { _all: true },
    }),
    prisma.industryTaxonomyVersion.findFirst({ where: { isCurrent: true } }),
  ]);
  const industries = version
    ? await prisma.industry.findMany({
        where: { versionId: version.id, isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, parentId: true, _count: { select: { companies: true } } },
      })
    : [];

  const byCountry = new Map(countryCounts.map((c) => [c.countryCode, c._count._all]));
  const byCity = new Map(cityCounts.map((c) => [c.cityId, c._count._all]));
  const sectors = industries
    .filter((i) => !i.parentId)
    .map((s) => {
      const children = industries.filter((i) => i.parentId === s.id).map((c) => ({ id: c.id, name: c.name, companies: c._count.companies }));
      return { id: s.id, name: s.name, companies: s._count.companies + children.reduce((n, c) => n + c.companies, 0), children };
    });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Market Explorer"
        description="Browse companies already in LeadForge by geography and industry, then turn the selection into a discovery project."
      />
      <Explorer
        continents={continents}
        countries={countries.map((c) => ({ ...c, companies: byCountry.get(c.iso2) ?? 0 }))}
        cities={cities.map((c) => ({
          id: c.id,
          name: c.name,
          countryIso2: c.countryIso2,
          regionName: c.region?.name ?? null,
          latitude: c.latitude,
          longitude: c.longitude,
          companies: byCity.get(c.id) ?? 0,
        }))}
        industries={sectors}
      />
    </div>
  );
}
