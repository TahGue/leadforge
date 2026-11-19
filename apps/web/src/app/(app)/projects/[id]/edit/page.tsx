import { getProject } from "@leadforge/pipeline";
import type { DiscoveryProjectInput } from "@leadforge/shared";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ProjectWizard } from "@/components/project-wizard";
import { wizardData } from "../../wizard-data";

export const dynamic = "force-dynamic";

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const [project, data] = await Promise.all([getProject(session.organization.id, id), wizardData(session.organization.id)]);
  const input: DiscoveryProjectInput = {
    name: project.name,
    description: project.description ?? undefined,
    geographicMode: project.geographicMode,
    maxCompanies: project.maxCompanies,
    maxPagesPerCompany: project.maxPagesPerCompany,
    maxCrawlDepth: project.maxCrawlDepth,
    minConfidence: project.minConfidence,
    locations: project.locations.map((l) => ({
      mode: l.mode,
      level: l.level,
      continentCode: l.continentCode ?? undefined,
      countryIso2: l.countryIso2 ?? undefined,
      regionId: l.regionId ?? undefined,
      cityId: l.cityId ?? undefined,
      postalPrefix: l.postalPrefix ?? undefined,
      latitude: l.latitude ?? undefined,
      longitude: l.longitude ?? undefined,
      radiusKm: l.radiusKm ?? undefined,
      includeNearby: l.includeNearby,
    })),
    industries: project.industries.map((f) => ({ industryId: f.industryId, mode: f.mode, isPrimary: f.isPrimary, includeDescendants: f.includeDescendants })),
    keywords: project.keywords.map((k) => ({ keyword: k.keyword, keywordType: k.keywordType as "GENERAL", mode: k.mode, language: k.language ?? undefined })),
    sources: project.sources.map((s) => ({ sourceId: s.sourceId, enabled: s.enabled, configuration: (s.configuration ?? {}) as Record<string, unknown> })),
    settings: project.settings,
  };
  const labels = project.locations.map((l) => l.city?.name ?? l.region?.name ?? l.country?.name ?? l.continentCode ?? l.postalPrefix ?? l.level);
  return (
    <div className="space-y-5">
      <PageHeader title={`Edit: ${project.name}`} description="Pause the project before changing its scope." />
      <ProjectWizard {...data} initial={{ id: project.id, input, locationLabels: labels }} />
    </div>
  );
}
