import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { ApiError, normalizeEmail, parseBody, verifyRequest } from "@leadforge/shared";
import { isDisposableDomain, isFreeProvider, isRoleAccount } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";
import { verifyEmail } from "@leadforge/pipeline";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (request: NextRequest, session) => {
  const input = await parseBody(request, verifyRequest);

  let emailId = input.emailId;
  if (!emailId && input.email) {
    const normalized = normalizeEmail(input.email);
    if (!normalized.valid) throw new ApiError(400, "VALIDATION_ERROR", "Invalid email address");
    const existing = await prisma.emailAddress.findUnique({
      where: { normalized: normalized.normalized },
    });
    emailId = existing
      ? existing.id
      : (
          await prisma.emailAddress.create({
            data: {
              address: normalized.address,
              normalized: normalized.normalized,
              localPart: normalized.localPart,
              domain: normalized.domain,
              isRoleAccount: isRoleAccount(normalized.localPart),
              isDisposable: isDisposableDomain(normalized.domain),
              isFreeProvider: isFreeProvider(normalized.domain),
            },
          })
        ).id;
  }

  if (!emailId) throw new ApiError(400, "VALIDATION_ERROR", "emailId or email is required");

  const result = await verifyEmail(emailId);

  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "email.verify",
    entity: "EmailAddress",
    entityId: emailId,
    metadata: { status: result.status },
  });

  return json({ data: result });
}, "ANALYST");
