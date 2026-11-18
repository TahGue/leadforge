import { previewProject } from "@leadforge/pipeline";
import { json, withAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

export const POST = withAuth<{ id: string }>(async (_request, session, params) => {
  return json({ data: await previewProject(session.organization.id, params.id) });
}, "VIEWER");
