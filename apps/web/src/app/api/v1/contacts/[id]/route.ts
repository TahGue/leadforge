import { prisma } from "@leadforge/database";
import { ApiError, contactUpdate, parseBody } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ id: string }>(async (_request, session, params) => {
  const contact = await prisma.contact.findFirst({
    where: { id: params.id, organizationId: session.organization.id, deletedAt: null },
    include: {
      company: { select: { id: true, name: true, countryCode: true } },
      emails: { include: { email: { include: { verifications: { orderBy: { checkedAt: "desc" }, take: 5 } } } } },
      evidence: { orderBy: { observedAt: "desc" }, take: 20 },
    },
  });
  if (!contact) throw new ApiError(404, "NOT_FOUND", "Contact not found");
  return json({ data: contact });
}, "VIEWER");

export const PATCH = withAuth<{ id: string }>(async (request, session, params) => {
  const input = await parseBody(request, contactUpdate);
  const contact = await prisma.contact.findFirst({
    where: { id: params.id, organizationId: session.organization.id, deletedAt: null },
  });
  if (!contact) throw new ApiError(404, "NOT_FOUND", "Contact not found");
  const { reviewed, ...fields } = input;
  const updated = await prisma.contact.update({
    where: { id: contact.id },
    data: { ...fields, ...(reviewed ? { reviewedAt: new Date() } : {}) },
  });
  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "contact.update",
    entity: "Contact",
    entityId: contact.id,
    metadata: { fields: Object.keys(input) },
  });
  return json({ data: updated });
}, "ANALYST");
