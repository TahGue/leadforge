import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { campaignCreate, parseBody } from "@leadforge/shared";
import { json, withCampaignAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withCampaignAuth(async (_request: NextRequest, session) => {
  const campaigns = await prisma.campaign.findMany({
    where: { organizationId: session.organization.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { recipients: true } } },
  });
  return json({ data: campaigns });
}, "VIEWER");

export const POST = withCampaignAuth(async (request: NextRequest, session) => {
  const input = await parseBody(request, campaignCreate);
  const campaign = await prisma.campaign.create({
    data: {
      organizationId: session.organization.id,
      name: input.name,
      subject: input.subject,
      bodyHtml: input.bodyHtml,
      bodyText: input.bodyText,
      segmentDefinition: input.segmentDefinition,
      jurisdictionScope: input.jurisdictionScope,
      lawfulBasis: input.lawfulBasis,
      status: "DRAFT",
    },
  });

  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "campaign.create",
    entity: "Campaign",
    entityId: campaign.id,
  });

  return json({ data: campaign }, 201);
}, "ANALYST");
