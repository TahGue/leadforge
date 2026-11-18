import { cancelProject } from "@leadforge/pipeline";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Long-running work is asynchronous: the response carries the project state and a job id. */
export const POST = withAuth<{ id: string }>(async (_request, session, params) => {
  const project = await cancelProject(session.organization.id, params.id);
  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "discovery_project.cancel",
    entity: "DiscoveryProject",
    entityId: project.id,
  });
  return json({ data: project, jobId: `project:${project.id}` }, 202);
}, "ANALYST");
