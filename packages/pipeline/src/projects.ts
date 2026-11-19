/**
 * Discovery project persistence and lifecycle (spec sections 5, 16, 17).
 *
 *   DRAFT/READY --start--> RUNNING --pause--> PAUSED --resume--> RUNNING
 *        any non-terminal --cancel--> CANCELLED
 *   RUNNING --(all runs, candidates and crawls terminal)--> COMPLETED | FAILED
 *
 * Starting a project only creates DiscoveryRun rows (one per selected source);
 * the Python discovery worker claims them. Discovery never triggers a campaign.
 */
import { Prisma, prisma, type ProjectStatus } from "@leadforge/database";
import { ApiError, discoveryProjectSettings, type DiscoveryProjectInput } from "@leadforge/shared";
import { limits } from "./config";
import { enqueue, jobId, QUEUES } from "./queue";

type Tx = Prisma.TransactionClient;

const TRANSITIONS: Record<string, ProjectStatus[]> = {
  start: ["DRAFT", "READY", "COMPLETED", "FAILED"],
  pause: ["RUNNING", "QUEUED"],
  resume: ["PAUSED"],
  cancel: ["DRAFT", "READY", "QUEUED", "RUNNING", "PAUSED"],
};

export function canTransition(action: keyof typeof TRANSITIONS, status: ProjectStatus): boolean {
  return TRANSITIONS[action]!.includes(status);
}

export function requiresApproval(input: { maxCompanies: number; geographicMode: string }): boolean {
  return (
    input.maxCompanies > limits.highVolumeCompanies ||
    (input.geographicMode === "WORLDWIDE" && input.maxCompanies > limits.highVolumeCompanies / 5)
  );
}

async function writeFilters(tx: Tx, projectId: string, input: Partial<DiscoveryProjectInput>) {
  if (input.locations) {
    await tx.discoveryLocation.deleteMany({ where: { projectId } });
    if (input.locations.length) {
      await tx.discoveryLocation.createMany({
        data: input.locations.map((loc) => ({
          projectId,
          mode: loc.mode,
          level: loc.level,
          continentCode: loc.continentCode ?? null,
          countryIso2: loc.countryIso2 ?? null,
          regionId: loc.regionId ?? null,
          cityId: loc.cityId ?? null,
          postalPrefix: loc.postalPrefix ?? null,
          latitude: loc.latitude ?? null,
          longitude: loc.longitude ?? null,
          radiusKm: loc.radiusKm ?? null,
          includeNearby: loc.includeNearby,
        })),
      });
    }
  }
  if (input.industries) {
    await tx.discoveryIndustryFilter.deleteMany({ where: { projectId } });
    if (input.industries.length) {
      await tx.discoveryIndustryFilter.createMany({
        data: input.industries.map((f) => ({ projectId, ...f })),
        skipDuplicates: true,
      });
    }
  }
  if (input.keywords) {
    await tx.discoveryKeyword.deleteMany({ where: { projectId } });
    if (input.keywords.length) {
      await tx.discoveryKeyword.createMany({
        data: input.keywords.map((k) => ({ projectId, ...k, language: k.language ?? null })),
      });
    }
  }
  if (input.sources) {
    await tx.discoverySourceSelection.deleteMany({ where: { projectId } });
    if (input.sources.length) {
      await tx.discoverySourceSelection.createMany({
        data: input.sources.map((s) => ({
          projectId,
          sourceId: s.sourceId,
          enabled: s.enabled,
          configuration: s.configuration as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });
    }
  }
}

async function assertReferences(organizationId: string, input: Partial<DiscoveryProjectInput>) {
  const sourceIds = (input.sources ?? []).map((s) => s.sourceId);
  if (sourceIds.length) {
    const found = await prisma.source.count({ where: { organizationId, id: { in: sourceIds } } });
    if (found !== new Set(sourceIds).size) throw new ApiError(400, "VALIDATION_ERROR", "Unknown source selected");
  }
  const industryIds = (input.industries ?? []).map((i) => i.industryId);
  if (industryIds.length) {
    const found = await prisma.industry.count({ where: { id: { in: industryIds } } });
    if (found !== new Set(industryIds).size) throw new ApiError(400, "VALIDATION_ERROR", "Unknown industry selected");
  }
  const cityIds = (input.locations ?? []).flatMap((l) => (l.cityId ? [l.cityId] : []));
  const regionIds = (input.locations ?? []).flatMap((l) => (l.regionId ? [l.regionId] : []));
  const countries = (input.locations ?? []).flatMap((l) => (l.countryIso2 ? [l.countryIso2] : []));
  if (cityIds.length && (await prisma.city.count({ where: { id: { in: cityIds } } })) !== new Set(cityIds).size) {
    throw new ApiError(400, "VALIDATION_ERROR", "Unknown city selected");
  }
  if (regionIds.length && (await prisma.adminRegion.count({ where: { id: { in: regionIds } } })) !== new Set(regionIds).size) {
    throw new ApiError(400, "VALIDATION_ERROR", "Unknown region selected");
  }
  if (countries.length && (await prisma.country.count({ where: { iso2: { in: countries } } })) !== new Set(countries).size) {
    throw new ApiError(400, "VALIDATION_ERROR", "Unknown country selected");
  }
}

export async function createProject(organizationId: string, userId: string | null, input: DiscoveryProjectInput) {
  await assertReferences(organizationId, input);
  return prisma.$transaction(async (tx) => {
    const project = await tx.discoveryProject.create({
      data: {
        organizationId,
        createdById: userId && !userId.startsWith("api-key") ? userId : null,
        name: input.name,
        description: input.description,
        status: "READY",
        geographicMode: input.geographicMode,
        maxCompanies: input.maxCompanies,
        maxPagesPerCompany: input.maxPagesPerCompany,
        maxCrawlDepth: input.maxCrawlDepth,
        minConfidence: input.minConfidence,
        settings: input.settings as Prisma.InputJsonValue,
        requiresApproval: requiresApproval(input),
      },
    });
    await writeFilters(tx, project.id, input);
    return project;
  });
}

export async function updateProject(organizationId: string, projectId: string, input: Partial<DiscoveryProjectInput>) {
  const project = await prisma.discoveryProject.findFirst({ where: { id: projectId, organizationId } });
  if (!project) throw new ApiError(404, "NOT_FOUND", "Project not found");
  if (["RUNNING", "QUEUED"].includes(project.status)) {
    throw new ApiError(409, "CONFLICT", "Pause or cancel the project before changing its scope");
  }
  await assertReferences(organizationId, input);
  return prisma.$transaction(async (tx) => {
    const maxCompanies = input.maxCompanies ?? project.maxCompanies;
    const geographicMode = input.geographicMode ?? project.geographicMode;
    const needsApproval = requiresApproval({ maxCompanies, geographicMode });
    const updated = await tx.discoveryProject.update({
      where: { id: projectId },
      data: {
        name: input.name,
        description: input.description,
        geographicMode: input.geographicMode,
        maxCompanies: input.maxCompanies,
        maxPagesPerCompany: input.maxPagesPerCompany,
        maxCrawlDepth: input.maxCrawlDepth,
        minConfidence: input.minConfidence,
        settings: input.settings ? (input.settings as Prisma.InputJsonValue) : undefined,
        requiresApproval: needsApproval,
        // Changing the scope of an approved high-volume project voids the approval.
        ...(needsApproval && (input.maxCompanies !== undefined || input.geographicMode !== undefined)
          ? { approvedAt: null, approvedById: null }
          : {}),
      },
    });
    await writeFilters(tx, projectId, input);
    return updated;
  });
}

export async function getProject(organizationId: string, projectId: string) {
  const project = await prisma.discoveryProject.findFirst({
    where: { id: projectId, organizationId },
    include: {
      locations: {
        include: {
          country: { select: { name: true } },
          region: { select: { name: true } },
          city: { select: { name: true } },
        },
      },
      industries: { include: { industry: { select: { code: true, name: true } } } },
      keywords: true,
      sources: { include: { source: { select: { name: true, adapter: true, policyStatus: true, enabled: true, permitted: true } } } },
      runs: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!project) throw new ApiError(404, "NOT_FOUND", "Project not found");
  return { ...project, settings: discoveryProjectSettings.parse(project.settings ?? {}) };
}

/** A source may be used for automated discovery only when its policy is approved and it is enabled. */
export function sourceUsable(source: { policyStatus: string; enabled: boolean; permitted: boolean }): boolean {
  return source.policyStatus === "APPROVED" && source.enabled && source.permitted;
}

export async function approveProject(organizationId: string, projectId: string, userId: string) {
  const project = await prisma.discoveryProject.findFirst({ where: { id: projectId, organizationId } });
  if (!project) throw new ApiError(404, "NOT_FOUND", "Project not found");
  return prisma.discoveryProject.update({
    where: { id: projectId },
    data: { approvedAt: new Date(), approvedById: userId },
  });
}

export async function startProject(organizationId: string, projectId: string) {
  const project = await prisma.discoveryProject.findFirst({
    where: { id: projectId, organizationId },
    include: { sources: { where: { enabled: true }, include: { source: true } } },
  });
  if (!project) throw new ApiError(404, "NOT_FOUND", "Project not found");
  if (!canTransition("start", project.status)) {
    throw new ApiError(409, "CONFLICT", `Cannot start a project in status ${project.status}`);
  }
  if (project.requiresApproval && !project.approvedAt) {
    throw new ApiError(409, "CONFLICT", "High-volume project requires human approval before it can start");
  }
  const usable = project.sources.filter((s) => sourceUsable(s.source));
  if (!usable.length) {
    throw new ApiError(
      409,
      "CONFLICT",
      "No selected source has an approved policy; review the source policy before starting discovery",
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    for (const selection of usable) {
      await tx.discoveryRun.upsert({
        where: { projectId_sourceId: { projectId, sourceId: selection.sourceId } },
        create: {
          organizationId,
          projectId,
          sourceId: selection.sourceId,
          query: selection.configuration as Prisma.InputJsonValue,
          maxAttempts: 1 + discoveryProjectSettings.parse(project.settings ?? {}).crawl.retryCount,
        },
        update: {
          status: "QUEUED",
          attemptCount: 0,
          errorCode: null,
          errorMessage: null,
          policyStopReason: null,
          scheduledFor: new Date(),
          startedAt: null,
          finishedAt: null,
          query: selection.configuration as Prisma.InputJsonValue,
        },
      });
    }
    return tx.discoveryProject.update({
      where: { id: projectId },
      data: { status: "RUNNING", startedAt: new Date(), finishedAt: null, lastError: null },
    });
  });

  await enqueue(QUEUES.discovery, { projectId }, jobId("discovery", projectId, String(Date.now())));
  return updated;
}

export async function pauseProject(organizationId: string, projectId: string) {
  return transition(organizationId, projectId, "pause", "PAUSED");
}

export async function resumeProject(organizationId: string, projectId: string) {
  const project = await transition(organizationId, projectId, "resume", "RUNNING");
  await enqueue(QUEUES.discovery, { projectId }, jobId("discovery", projectId, String(Date.now())));
  return project;
}

export async function cancelProject(organizationId: string, projectId: string) {
  const project = await transition(organizationId, projectId, "cancel", "CANCELLED", async (tx) => {
    await tx.discoveryRun.updateMany({
      where: { projectId, status: { in: ["QUEUED", "RUNNING"] } },
      data: { status: "CANCELLED", finishedAt: new Date() },
    });
    await tx.crawlJob.updateMany({
      where: { projectId, status: { in: ["QUEUED"] } },
      data: { status: "CANCELLED", finishedAt: new Date() },
    });
    await tx.companyCandidate.updateMany({
      where: { projectId, status: "PENDING" },
      data: { status: "REJECTED", rejectReason: "project_cancelled", processedAt: new Date() },
    });
  });
  return project;
}

async function transition(
  organizationId: string,
  projectId: string,
  action: keyof typeof TRANSITIONS,
  to: ProjectStatus,
  extra?: (tx: Tx) => Promise<void>,
) {
  return prisma.$transaction(async (tx) => {
    const project = await tx.discoveryProject.findFirst({ where: { id: projectId, organizationId } });
    if (!project) throw new ApiError(404, "NOT_FOUND", "Project not found");
    if (!canTransition(action, project.status)) {
      throw new ApiError(409, "CONFLICT", `Cannot ${action} a project in status ${project.status}`);
    }
    await extra?.(tx);
    return tx.discoveryProject.update({
      where: { id: projectId },
      data: { status: to, ...(to === "CANCELLED" ? { finishedAt: new Date() } : {}) },
    });
  });
}

export async function deleteProject(organizationId: string, projectId: string) {
  const project = await prisma.discoveryProject.findFirst({ where: { id: projectId, organizationId } });
  if (!project) throw new ApiError(404, "NOT_FOUND", "Project not found");
  if (["RUNNING", "QUEUED"].includes(project.status)) {
    throw new ApiError(409, "CONFLICT", "Cancel the project before deleting it");
  }
  // Companies discovered by the project are kept: they are org data with their own provenance.
  await prisma.$transaction([
    prisma.companyCandidate.deleteMany({ where: { projectId } }),
    prisma.discoveryProject.delete({ where: { id: projectId } }),
  ]);
}
