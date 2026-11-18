import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { json, withAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (request: NextRequest) => {
  const url = new URL(request.url);
  const continent = url.searchParams.get("continent")?.toUpperCase();
  const q = url.searchParams.get("q")?.trim();
  const countries = await prisma.country.findMany({
    where: {
      ...(continent ? { continentCode: continent } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { iso2: q.toUpperCase() }] } : {}),
    },
    orderBy: { name: "asc" },
    select: {
      iso2: true,
      iso3: true,
      name: true,
      continentCode: true,
      _count: { select: { regions: true, cities: true } },
    },
  });
  return json({ data: countries });
}, "VIEWER");
