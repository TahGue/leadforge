import { prisma } from "@leadforge/database";
import { discoveryProjectSettings, type DiscoveryProjectInput } from "@leadforge/shared";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ProjectWizard } from "@/components/project-wizard";
import { wizardData } from "../wizard-data";

export const dynamic = "force-dynamic";

/** Optional ?continent=&country=&city=&industry= pre-fill from the Market Explorer. */
export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ continent?: string; country?: string; city?: string; industry?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const data = await wizardData(session.organization.id);

  let initial: { id: string; input: DiscoveryProjectInput; locationLabels: string[] } | undefined;
  if (params.continent || params.country || params.city || params.industry) {
    const locations: DiscoveryProjectInput["locations"] = [];
    const labels: string[] = [];
    if (params.city) {
      const city = await prisma.city.findUnique({ where: { id: params.city }, include: { country: true } });
      if (city) {
        locations.push({ mode: "INCLUDE", level: "CITY", cityId: city.id, countryIso2: city.countryIso2, includeNearby: false });
        labels.push(`${city.name}, ${city.country.name}`);
      }
    } else if (params.country) {
      const country = await prisma.country.findUnique({ where: { iso2: params.country } });
      if (country) {
        locations.push({ mode: "INCLUDE", level: "COUNTRY", countryIso2: country.iso2, includeNearby: false });
        labels.push(country.name);
      }
    } else if (params.continent) {
      const continent = await prisma.continent.findUnique({ where: { code: params.continent } });
      if (continent) {
        locations.push({ mode: "INCLUDE", level: "CONTINENT", continentCode: continent.code, includeNearby: false });
        labels.push(continent.name);
      }
    }
    initial = {
      id: "",
      locationLabels: labels,
      input: {
        name: "",
        geographicMode: params.city ? "CITY" : params.country ? "COUNTRY" : params.continent ? "CONTINENT" : "WORLDWIDE",
        maxCompanies: 500,
        maxPagesPerCompany: 12,
        maxCrawlDepth: 2,
        minConfidence: 0.5,
        locations,
        industries: params.industry ? [{ industryId: params.industry, mode: "INCLUDE", isPrimary: false, includeDescendants: true }] : [],
        keywords: [],
        sources: [],
        settings: discoveryProjectSettings.parse({}),
      },
    };
  }

  return (
    <div className="space-y-5">
      <PageHeader title="New discovery project" description="Define where and what to discover. Nothing runs until you start the project." />
      <ProjectWizard {...data} initial={initial?.id === "" ? { ...initial, id: undefined as unknown as string } : initial} />
    </div>
  );
}
