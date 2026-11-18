import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { ApiError, companyUpdate, parseBody } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ id: string }>(async (_request, session, params) => {
  const company = await prisma.company.findFirst({
    where: { id: params.id, organizationId: session.organization.id, deletedAt: null },
    include: {
      domains: { include: { domain: true } },
      contacts: {
        include: {
          emails: {
            include: {
              email: { include: { verifications: { orderBy: { checkedAt: "desc" }, take: 1 } } },
            },
          },
        },
        orderBy: { updatedAt: "desc" },
      },
      evidence: { orderBy: { observedAt: "desc" }, take: 50 },
    },
  });

  if (!company) throw new ApiError(404, "NOT_FOUND", "Company not found");
  return json({ data: company });
}, "VIEWER");

export const PATCH = withAuth<{ id: string }>(async (request, session, params) => {
  const input = await parseBody(request, companyUpdate);

  const existing = await prisma.company.findFirst({
    where: { id: params.id, organizationId: session.organization.id },
  });
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Company not found");

  const updated = await prisma.company.update({ where: { id: existing.id }, data: input });

  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "company.update",
    entity: "Company",
    entityId: updated.id,
    metadata: { fields: Object.keys(input) },
  });

  return json({ data: updated });
}, "ANALYST");

