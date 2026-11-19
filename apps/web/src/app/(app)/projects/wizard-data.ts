import { prisma } from "@leadforge/database";
import type { GeoOptions } from "@/components/geo-picker";
import type { IndustryNode } from "@/components/industry-picker";
import type { WizardSource } from "@/components/project-wizard";

/** Reference data the wizard needs, loaded on the server. */
export async function wizardData(organizationId: string): Promise<{ geo: GeoOptions; industries: IndustryNode[]; sources: WizardSource[] }> {
  const [continents, countries, version, sources] = await Promise.all([
    prisma.continent.findMany({ orderBy: { name: "asc" }, select: { code: true, name: true } }),
    prisma.country.findMany({ orderBy: { name: "asc" }, select: { iso2: true, name: true, continentCode: true } }),
    prisma.industryTaxonomyVersion.findFirst({ where: { isCurrent: true } }),
    prisma.source.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, adapter: true, sourceType: true, policyStatus: true, enabled: true, permitted: true, licenceName: true },
    }),
  ]);
  const flat = version
    ? await prisma.industry.findMany({
        where: { versionId: version.id, isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true, parentId: true, externalCodes: { select: { scheme: true, code: true } } },
      })
    : [];
  const industries: IndustryNode[] = flat
    .filter((i) => !i.parentId)
    .map((s) => ({ ...s, children: flat.filter((c) => c.parentId === s.id) }));
  return { geo: { continents, countries }, industries, sources };
}
