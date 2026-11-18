import type { NextRequest } from "next/server";
import { eligibilityRequest, parseBody } from "@leadforge/shared";
import { json, withCampaignAuth } from "@/lib/api";
import { evaluateEmailForCampaign } from "@/lib/eligibility";

export const dynamic = "force-dynamic";

export const POST = withCampaignAuth(async (request: NextRequest, session) => {
  const input = await parseBody(request, eligibilityRequest);
  const evaluation = await evaluateEmailForCampaign({
    organizationId: session.organization.id,
    emailId: input.emailId,
    campaignId: input.campaignId ?? null,
    purpose: input.purpose,
  });
  return json({ data: evaluation });
}, "VIEWER");
