import type { NextRequest } from "next/server";
import { json, withCampaignAuth } from "@/lib/api";
import { audit } from "@/lib/audit";
import { buildRecipients } from "@/lib/campaign";

export const dynamic = "force-dynamic";

/** Builds the immutable recipient snapshot and evaluates every address. */
export const POST = withCampaignAuth<{ id: string }>(async (_request, session, params) => {
  const result = await buildRecipients(params.id, session.organization.id);

  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "campaign.prepare",
    entity: "Campaign",
    entityId: params.id,
    metadata: { ...result },
  });

  return json({ data: result });
}, "ANALYST");
