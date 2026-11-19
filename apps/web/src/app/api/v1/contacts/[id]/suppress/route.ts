import { prisma } from "@leadforge/database";
import { ApiError } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Suppress every address on the contact for this organization. */
export const POST = withAuth<{ id: string }>(async (_request, session, params) => {
  const contact = await prisma.contact.findFirst({
    where: { id: params.id, organizationId: session.organization.id },
    include: { emails: { include: { email: true } } },
  });
  if (!contact) throw new ApiError(404, "NOT_FOUND", "Contact not found");
  let added = 0;
  for (const link of contact.emails) {
    const normalized = link.email.normalized;
    await prisma.suppressionEntry.upsert({
      where: {
        organizationId_emailNormalized_reason: {
          organizationId: session.organization.id,
          emailNormalized: normalized,
          reason: "MANUAL",
        },
      },
      create: {
        organizationId: session.organization.id,
        emailNormalized: normalized,
        domain: link.email.domain,
        reason: "MANUAL",
        source: `contact:${contact.id}`,
      },
      update: { liftedAt: null },
    });
    await prisma.emailAddress.update({ where: { id: link.emailId }, data: { status: "SUPPRESSED" } });
    added += 1;
  }
  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "contact.suppress",
    entity: "Contact",
    entityId: contact.id,
    metadata: { addresses: added },
  });
  return json({ data: { suppressed: added } });
}, "ANALYST");
