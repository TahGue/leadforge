import { z } from "zod";
import { prisma } from "@leadforge/database";
import { eraseEmail } from "@leadforge/pipeline";
import { ApiError, normalizeEmail, parseBody } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const eraseRequest = z.object({ email: z.string().email(), reference: z.string().max(200).optional() });

/**
 * Erasure request (spec 18): deletes the person's contact data and keeps only a
 * suppression entry so the address is never re-imported or contacted again.
 */
export const POST = withAuth(async (request, session) => {
  const input = await parseBody(request, eraseRequest);
  const normalized = normalizeEmail(input.email);
  if (!normalized.valid) throw new ApiError(400, "VALIDATION_ERROR", "Invalid email");
  const result = await eraseEmail(session.organization.id, normalized.normalized);
  await prisma.dataSubjectRequest.create({
    data: {
      organizationId: session.organization.id,
      type: "ERASURE",
      subjectEmail: normalized.normalized,
      status: "COMPLETED",
      dueAt: new Date(Date.now() + 30 * 86_400_000),
      completedAt: new Date(),
      evidence: { reference: input.reference ?? null, contactsRemoved: result.contacts },
    },
  });
  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "data_request.erase",
    entity: "DataSubjectRequest",
    metadata: { contactsRemoved: result.contacts, reference: input.reference ?? null },
  });
  return json({ data: result });
}, "ADMIN");
