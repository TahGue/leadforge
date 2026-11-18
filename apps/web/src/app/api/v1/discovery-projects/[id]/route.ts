import { deleteProject, getProject, updateProject } from "@leadforge/pipeline";
import { discoveryProjectPatch, parseBody } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ id: string }>(async (_request, session, params) => {
  return json({ data: await getProject(session.organization.id, params.id) });
}, "VIEWER");

export const PATCH = withAuth<{ id: string }>(async (request, session, params) => {
  const input = await parseBody(request, discoveryProjectPatch);
  const project = await updateProject(session.organization.id, params.id, input);
  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "discovery_project.update",
    entity: "DiscoveryProject",
    entityId: project.id,
    metadata: { fields: Object.keys(input) },
  });
  return json({ data: project });
}, "ANALYST");

export const DELETE = withAuth<{ id: string }>(async (_request, session, params) => {
  await deleteProject(session.organization.id, params.id);
  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "discovery_project.delete",
    entity: "DiscoveryProject",
    entityId: params.id,
  });
  return json({ data: { id: params.id, deleted: true } });
}, "ADMIN");
