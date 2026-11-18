import { prisma } from "@leadforge/database";
import { projectProgress } from "@leadforge/pipeline";
import { ApiError } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ id: string }>(async (_request, session, params) => {
  const project = await prisma.discoveryProject.findFirst({
    where: { id: params.id, organizationId: session.organization.id },
    select: { id: true, status: true, startedAt: true, finishedAt: true, lastError: true, maxCompanies: true },
  });
  if (!project) throw new ApiError(404, "NOT_FOUND", "Project not found");
  return json({ data: { project, ...(await projectProgress(project.id)) } });
}, "VIEWER");
