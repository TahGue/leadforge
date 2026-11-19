import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { ApiError } from "@leadforge/shared";
import { json, withCampaignAuth } from "@/lib/api";
import { recipientCounts } from "@/lib/campaign";

export const dynamic = "force-dynamic";

export const GET = withCampaignAuth<{ id: string }>(async (_request, session, params) => {
  const campaign = await prisma.campaign.findFirst({
    where: { id: params.id, organizationId: session.organization.id },
  });
  if (!campaign) throw new ApiError(404, "NOT_FOUND", "Campaign not found");

  const [counts, recipients] = await Promise.all([
    recipientCounts(campaign.id),
    prisma.campaignRecipient.findMany({
      where: { campaignId: campaign.id },
      orderBy: { queuedAt: "asc" },
      take: 200,
      include: { email: { select: { normalized: true, status: true } } },
    }),
  ]);

  return json({ data: { campaign, counts, recipients } });
}, "VIEWER");
