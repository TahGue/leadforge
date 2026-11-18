import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { discoveryProjectCreate, parseBody } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (_request: NextRequest, session) => {
  const projects = await prisma.discoveryProject.findMany({
    where: { organizationId: session.organization.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { crawlTargets: true } } },
  });
  return json({ data: projects });
}, "VIEWER");

export const POST = withAuth(async (request: NextRequest, session) => {
  const input = await parseBody(request, discoveryProjectCreate);
  const project = await prisma.discoveryProject.create({
    data: {
      organizationId: session.organization.id,
      name: input.name,
      description: input.description,
      criteria: input.criteria,
      budget: input.budget,
      status: "READY",
    },
  });

  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "discovery_project.create",
    entity: "DiscoveryProject",
    entityId: project.id,
  });

  return json({ data: project }, 201);
}, "ANALYST");
