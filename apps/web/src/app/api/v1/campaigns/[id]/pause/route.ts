import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { ApiError } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const POST = withAuth<{ id: string }>(async (_request, session, params) => {
  const campaign = await prisma.campaign.findFirst({
    where: { id: params.id, organizationId: session.organization.id },
  });
  if (!campaign) throw new ApiError(404, "NOT_FOUND", "Campaign not found");
  if (!["RUNNING", "PAUSED"].includes(campaign.status)) {
    throw new ApiError(409, "CONFLICT", "Only a running or paused campaign can be toggled");
  }

  const updated = await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: campaign.status === "RUNNING" ? "PAUSED" : "RUNNING" },
  });

  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: `campaign.${updated.status === "PAUSED" ? "pause" : "resume"}`,
    entity: "Campaign",
    entityId: campaign.id,
  });

  return json({ data: updated });
}, "ANALYST");
