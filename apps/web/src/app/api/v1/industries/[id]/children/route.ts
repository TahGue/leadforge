import { prisma } from "@leadforge/database";
import { ApiError } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ id: string }>(async (_request, _session, params) => {
  const parent = await prisma.industry.findUnique({ where: { id: params.id } });
  if (!parent) throw new ApiError(404, "NOT_FOUND", "Industry not found");
  const children = await prisma.industry.findMany({
    where: { parentId: params.id, isActive: true },
    orderBy: { name: "asc" },
    include: { externalCodes: { select: { scheme: true, code: true } }, _count: { select: { companies: true } } },
  });
  return json({ data: children, parent });
}, "VIEWER");
