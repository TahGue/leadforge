import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { ApiError, normalizeEmail } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { createUnsubscribeLink, renderFooter, sendCampaignEmail } from "@/lib/mail";

export const dynamic = "force-dynamic";

export const POST = withAuth<{ id: string }>(async (request, session, params) => {
  const body = (await request.json().catch(() => ({}))) as { to?: string };
  const campaign = await prisma.campaign.findFirst({
    where: { id: params.id, organizationId: session.organization.id },
  });
  if (!campaign) throw new ApiError(404, "NOT_FOUND", "Campaign not found");

  const target = body.to ?? env.mailTestAllowlist[0];
  if (!target) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "No test recipient configured. Set MAIL_TEST_ALLOWLIST or pass { to }.",
    );
  }
  if (!env.mailTestAllowlist.includes(target.toLowerCase())) {
    throw new ApiError(403, "FORBIDDEN", "Test sends are restricted to the allowlist");
  }

  const normalized = normalizeEmail(target);
  if (!normalized.valid) throw new ApiError(400, "VALIDATION_ERROR", "Invalid email");

  const unsubscribeUrl = await createUnsubscribeLink(normalized.normalized, campaign.id);
  const html = `${campaign.bodyHtml}${renderFooter({ unsubscribeUrl })}`;

  const outcome = await sendCampaignEmail({
    to: target,
    subject: `[TEST] ${campaign.subject}`,
    html,
    text: `${campaign.bodyText}\n\nUnsubscribe: ${unsubscribeUrl}`,
    campaignId: campaign.id,
  });

  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "campaign.test_send",
    entity: "Campaign",
    entityId: campaign.id,
    metadata: { to: target, sent: outcome.sent, reason: outcome.reason ?? null },
  });

  return json({ data: outcome });
}, "ADMIN");
