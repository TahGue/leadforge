import { prisma } from "@leadforge/database";
import { ApiError } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const DELETE = withAuth<{ id: string }>(async (_request, session, params) => {
  const result = await prisma.savedSegment.deleteMany({
    where: { id: params.id, organizationId: session.organization.id },
  });
  if (!result.count) throw new ApiError(404, "NOT_FOUND", "Segment not found");
  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "segment.delete",
    entity: "SavedSegment",
    entityId: params.id,
  });
  return json({ data: { id: params.id, deleted: true } });
}, "ANALYST");
