import { prisma } from "@leadforge/database";
import { json, withAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  const continents = await prisma.continent.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { countries: true } } },
  });
  return json({ data: continents });
}, "VIEWER");
