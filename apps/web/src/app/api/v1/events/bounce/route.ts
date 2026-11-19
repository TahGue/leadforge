import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { ApiError, bounceEvent, normalizeEmail, parseBody } from "@leadforge/shared";
import { handleError, json } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Constant-time comparison, so the key cannot be recovered from response timing. */
function sameSecret(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Bounce / complaint ingestion from the MTA or a relay webhook.
 * Authenticated with a shared secret header, not a user session.
 */
export async function POST(request: NextRequest) {
  try {
    const expected = process.env.BOUNCE_INGEST_KEY;
    const provided = request.headers.get("x-leadforge-key");
    if (!expected || !provided || !sameSecret(provided, expected)) {
      throw new ApiError(401, "UNAUTHENTICATED", "Invalid ingestion key");
    }

    const input = await parseBody(request, bounceEvent);
    const normalized = normalizeEmail(input.email);
    if (!normalized.valid) throw new ApiError(400, "VALIDATION_ERROR", "Invalid email");

    const reason = input.type === "COMPLAINT" ? "COMPLAINT" : input.type === "BOUNCE_HARD" ? "HARD_BOUNCE" : null;

    if (reason) {
      const existing = await prisma.suppressionEntry.findFirst({
        where: { organizationId: null, emailNormalized: normalized.normalized, reason, liftedAt: null },
      });
      if (!existing) {
        await prisma.suppressionEntry.create({
          data: {
            organizationId: null,
            emailNormalized: normalized.normalized,
            domain: normalized.domain,
            reason,
            source: "bounce_ingest",
          },
        });
      }
    }

    if (input.type === "BOUNCE_HARD") {
      await prisma.emailAddress.updateMany({
        where: { normalized: normalized.normalized },
        data: { status: "UNDELIVERABLE" },
      });
    }

    const email = await prisma.emailAddress.findUnique({
      where: { normalized: normalized.normalized },
    });

    await prisma.emailEvent.create({
      data: {
        organizationId: null,
        emailId: email?.id,
        campaignId: input.campaignId,
        type: input.type,
        providerMessageId: input.messageId,
        metadata: { detail: input.detail ?? null },
      },
    });

    return json({ ok: true }, 202);
  } catch (error) {
    return handleError(error);
  }
}
