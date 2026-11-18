import { prisma, type Prisma } from "@leadforge/database";
import { parseBody, savedSegmentCreate } from "@leadforge/shared";
import { actorUserId, json, withAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (_request, session) => {
  const segments = await prisma.savedSegment.findMany({
    where: { organizationId: session.organization.id },
    orderBy: { name: "asc" },
  });
  return json({ data: segments });
}, "VIEWER");

export const POST = withAuth(async (request, session) => {
  const input = await parseBody(request, savedSegmentCreate);
  const segment = await prisma.savedSegment.upsert({
    where: { organizationId_name: { organizationId: session.organization.id, name: input.name } },
    create: {
      organizationId: session.organization.id,
      name: input.name,
      entity: input.entity,
      filters: input.filters as Prisma.InputJsonValue,
      createdById: actorUserId(session),
    },
    update: { entity: input.entity, filters: input.filters as Prisma.InputJsonValue },
  });
  return json({ data: segment }, 201);
}, "ANALYST");
