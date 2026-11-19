import { approveProject } from "@leadforge/pipeline";
import { ApiError } from "@leadforge/shared";
import { actorUserId, json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Human approval for high-volume runs (spec 5.7). Must be a person, not an API key. */
export const POST = withAuth<{ id: string }>(async (_request, session, params) => {
  const userId = actorUserId(session);
  if (!userId) throw new ApiError(403, "FORBIDDEN", "High-volume approval must be given by a person");
  const project = await approveProject(session.organization.id, params.id, userId);
  await audit({
    organizationId: session.organization.id,
    actorId: userId,
    action: "discovery_project.approve",
    entity: "DiscoveryProject",
    entityId: project.id,
    metadata: { maxCompanies: project.maxCompanies, geographicMode: project.geographicMode },
  });
  return json({ data: project });
}, "ADMIN");
