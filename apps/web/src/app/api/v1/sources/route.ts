import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { parseBody, sourceCreate } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (_request: NextRequest, session) => {
  const sources = await prisma.source.findMany({
    where: { organizationId: session.organization.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { crawlTargets: true } } },
  });
  return json({ data: sources });
}, "VIEWER");

export const POST = withAuth(async (request: NextRequest, session) => {
  const input = await parseBody(request, sourceCreate);
  const source = await prisma.source.create({
    data: {
      organizationId: session.organization.id,
      name: input.name,
      sourceType: input.sourceType,
      baseUrl: input.baseUrl,
      policyNotes: input.policyNotes,
      tosUrl: input.tosUrl,
      // Collection is blocked until a human records the policy review.
      permitted: false,
    },
  });

  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "source.create",
    entity: "Source",
    entityId: source.id,
  });

  return json({ data: source }, 201);
}, "ADMIN");
