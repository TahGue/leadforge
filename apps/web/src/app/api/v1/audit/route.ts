import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { json, withAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (_request: NextRequest, session) => {
  const entries = await prisma.auditLog.findMany({
    where: { organizationId: session.organization.id },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { actor: { select: { email: true } } },
  });
  return json({ data: entries });
}, "ADMIN");
