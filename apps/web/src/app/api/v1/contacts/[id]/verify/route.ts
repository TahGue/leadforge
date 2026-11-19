import { prisma } from "@leadforge/database";
import { verifyEmail } from "@leadforge/pipeline";
import { ApiError } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Syntax + DNS + MX for every address on the contact. Never probes mailboxes. */
export const POST = withAuth<{ id: string }>(async (_request, session, params) => {
  const contact = await prisma.contact.findFirst({
    where: { id: params.id, organizationId: session.organization.id, deletedAt: null },
    include: { emails: true },
  });
  if (!contact) throw new ApiError(404, "NOT_FOUND", "Contact not found");
  const results = [];
  for (const link of contact.emails) results.push(await verifyEmail(link.emailId));
  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "contact.verify",
    entity: "Contact",
    entityId: contact.id,
    metadata: { emails: results.map((r) => ({ status: r.status, mx: r.mxStatus })) },
  });
  return json({ data: results });
}, "ANALYST");
