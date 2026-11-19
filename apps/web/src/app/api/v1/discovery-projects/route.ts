import type { NextRequest } from "next/server";
import { prisma, type ProjectStatus } from "@leadforge/database";
import { createProject } from "@leadforge/pipeline";
import { discoveryProjectInput, parseBody } from "@leadforge/shared";
import { actorUserId, json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["DRAFT", "READY", "QUEUED", "RUNNING", "PAUSED", "COMPLETED", "CANCELLED", "FAILED"]);

export const GET = withAuth(async (request: NextRequest, session) => {
  const status = new URL(request.url).searchParams.get("status")?.toUpperCase();
  const projects = await prisma.discoveryProject.findMany({
    where: {
      organizationId: session.organization.id,
      ...(status && STATUSES.has(status) ? { status: status as ProjectStatus } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { _count: { select: { companies: true, crawlJobs: true, runs: true } } },
  });
  return json({ data: projects });
}, "VIEWER");

export const POST = withAuth(async (request: NextRequest, session) => {
  const input = await parseBody(request, discoveryProjectInput);
  const project = await createProject(session.organization.id, actorUserId(session), input);
  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "discovery_project.create",
    entity: "DiscoveryProject",
    entityId: project.id,
    metadata: { locations: input.locations.length, industries: input.industries.length, sources: input.sources.length },
  });
  return json({ data: project }, 201);
}, "ANALYST");
