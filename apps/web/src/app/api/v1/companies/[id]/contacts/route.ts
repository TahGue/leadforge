import { prisma } from "@leadforge/database";
import { ApiError } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ id: string }>(async (_request, session, params) => {
  const company = await prisma.company.findFirst({
    where: { id: params.id, organizationId: session.organization.id },
    select: { id: true },
  });
  if (!company) throw new ApiError(404, "NOT_FOUND", "Company not found");
  const contacts = await prisma.contact.findMany({
    where: { companyId: company.id, deletedAt: null },
    orderBy: [{ category: "asc" }, { confidence: "desc" }],
    include: {
      emails: { include: { email: { include: { verifications: { orderBy: { checkedAt: "desc" }, take: 1 } } } } },
      evidence: { orderBy: { observedAt: "desc" }, take: 3 },
    },
  });
  return json({ data: contacts });
}, "VIEWER");
