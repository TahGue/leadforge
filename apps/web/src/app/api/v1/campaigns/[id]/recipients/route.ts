import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { ApiError } from "@leadforge/shared";
import { json, withCampaignAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withCampaignAuth<{ id: string }>(async (request, session, params) => {
  const campaign = await prisma.campaign.findFirst({
    where: { id: params.id, organizationId: session.organization.id },
  });
  if (!campaign) throw new ApiError(404, "NOT_FOUND", "Campaign not found");

  const status = new URL(request.url).searchParams.get("status") ?? undefined;
  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId: campaign.id, ...(status ? { status: status as never } : {}) },
    orderBy: { queuedAt: "asc" },
    take: 500,
    include: { sends: { orderBy: { sentAt: "desc" }, take: 1 } },
  });

  return json({ data: recipients });
}, "VIEWER");
