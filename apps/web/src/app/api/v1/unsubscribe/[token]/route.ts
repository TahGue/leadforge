import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { normalizeEmail } from "@leadforge/shared";
import { handleError } from "@/lib/api";
import { verifyUnsubscribeSignature } from "@/lib/mail";

export const dynamic = "force-dynamic";

const PAGE = (message: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Unsubscribe</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1.5rem;color:#111}</style>
</head><body><h1>Unsubscribe</h1><p>${message}</p></body></html>`;

async function suppress(emailNormalized: string, campaignId: string | null): Promise<void> {
  const existing = await prisma.suppressionEntry.findFirst({
    where: { organizationId: null, emailNormalized, reason: "UNSUBSCRIBED", liftedAt: null },
  });
  if (!existing) {
    await prisma.suppressionEntry.create({
      data: {
        organizationId: null,
        emailNormalized,
        domain: emailNormalized.split("@")[1],
        reason: "UNSUBSCRIBED",
        source: campaignId ? `unsubscribe:${campaignId}` : "unsubscribe",
      },
    });
  }

  await prisma.emailAddress.updateMany({
    where: { normalized: emailNormalized },
    data: { status: "SUPPRESSED" },
  });

  await prisma.unsubscribeToken.updateMany({
    where: { emailNormalized },
    data: { usedAt: new Date() },
  });
}

function parse(request: NextRequest, token: string) {
  const url = new URL(request.url);
  const email = url.searchParams.get("e");
  const campaign = url.searchParams.get("c");
  if (!email || !campaign) return null;
  const normalized = normalizeEmail(email);
  if (!normalized.valid) return null;
  if (!verifyUnsubscribeSignature(token, normalized.normalized, campaign)) return null;
  return { emailNormalized: normalized.normalized, campaignId: campaign };
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const parsed = parse(request, token);
    if (!parsed) {
      return new Response(PAGE("This unsubscribe link is invalid or has expired."), {
        status: 400,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    await suppress(parsed.emailNormalized, parsed.campaignId);
    return new Response(
      PAGE("You have been removed from this list. No further marketing email will be sent."),
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  } catch (error) {
    return handleError(error);
  }
}

/** RFC 8058 one-click unsubscribe. */
export async function POST(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const parsed = parse(request, token);
    if (!parsed) return new Response(null, { status: 400 });
    await suppress(parsed.emailNormalized, parsed.campaignId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return handleError(error);
  }
}
