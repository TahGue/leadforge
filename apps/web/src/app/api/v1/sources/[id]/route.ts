import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { ApiError, parseBody, sourcePolicyUpdate } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const PATCH = withAuth<{ id: string }>(async (request, session, params) => {
  const input = await parseBody(request, sourcePolicyUpdate);

  const source = await prisma.source.findFirst({
    where: { id: params.id, organizationId: session.organization.id },
  });
  if (!source) throw new ApiError(404, "NOT_FOUND", "Source not found");

  if (input.permitted && (!input.tosUrl || !input.policyNotes)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Approving a source requires a reviewed terms URL and policy notes",
    );
  }

  const updated = await prisma.source.update({
    where: { id: source.id },
    data: {
      permitted: input.permitted,
      policyNotes: input.policyNotes ?? source.policyNotes,
      tosUrl: input.tosUrl ?? source.tosUrl,
      ...(input.permitted
        ? { tosReviewedAt: new Date(), reviewedBy: session.user.id }
        : { tosReviewedAt: null, reviewedBy: null }),
    },
  });

  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: input.permitted ? "source.approve" : "source.revoke",
    entity: "Source",
    entityId: updated.id,
  });

  return json({ data: updated });
}, "ADMIN");
