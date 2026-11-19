import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { ApiError, campaignSchedule, parseBody } from "@leadforge/shared";
import { json, withCampaignAuth } from "@/lib/api";
import { audit } from "@/lib/audit";
import { recipientCounts } from "@/lib/campaign";

export const dynamic = "force-dynamic";

export const POST = withCampaignAuth<{ id: string }>(async (request, session, params) => {
  const body = await parseBody(request, campaignSchedule);
  const campaign = await prisma.campaign.findFirst({
    where: { id: params.id, organizationId: session.organization.id },
  });
  if (!campaign) throw new ApiError(404, "NOT_FOUND", "Campaign not found");
  if (!["DRAFT", "REVIEW"].includes(campaign.status)) {
    throw new ApiError(409, "CONFLICT", `Cannot approve a campaign in status ${campaign.status}`);
  }

  const counts = await recipientCounts(campaign.id);
  const pending = counts.PENDING ?? 0;
  if (pending === 0) {
    throw new ApiError(
      409,
      "CONFLICT",
      "No eligible recipients. Prepare the campaign and resolve eligibility first.",
    );
  }

  const approved = await prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      status: "SCHEDULED",
      approvedBy: session.user.id,
      approvedAt: new Date(),
      scheduledAt: body.scheduledAt,
    },
  });

  await prisma.domainEvent.create({
    data: {
      organizationId: session.organization.id,
      type: "campaign.approved",
      aggregateType: "Campaign",
      aggregateId: campaign.id,
      payload: { eligibleRecipients: pending, scheduledAt: body.scheduledAt.toISOString() },
    },
  });

  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "campaign.approve",
    entity: "Campaign",
    entityId: campaign.id,
    metadata: { scheduledAt: body.scheduledAt.toISOString(), counts },
  });

  return json({ data: approved });
}, "ADMIN");
