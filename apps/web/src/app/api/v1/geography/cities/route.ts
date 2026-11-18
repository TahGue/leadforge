import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { ApiError, normalizeName } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Cities are always scoped by country (city names repeat across countries, spec 5.1). */
export const GET = withAuth(async (request: NextRequest) => {
  const url = new URL(request.url);
  const country = url.searchParams.get("country")?.toUpperCase();
  const regionId = url.searchParams.get("regionId") ?? undefined;
  const q = url.searchParams.get("q")?.trim();
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 500);
  if (!country && !regionId) throw new ApiError(400, "VALIDATION_ERROR", "country or regionId is required");

  let ids: string[] | undefined;
  if (q) {
    const aliases = await prisma.geoAlias.findMany({
      where: { entityType: "CITY", normalized: { startsWith: normalizeName(q) } },
      select: { entityId: true },
      take: 500,
    });
    ids = [...new Set(aliases.map((a) => a.entityId))];
  }
  const cities = await prisma.city.findMany({
    where: {
      ...(country ? { countryIso2: country } : {}),
      ...(regionId ? { regionId } : {}),
      ...(ids ? { id: { in: ids } } : {}),
    },
    orderBy: [{ population: "desc" }, { name: "asc" }],
    take: limit,
    select: {
      id: true,
      externalId: true,
      name: true,
      countryIso2: true,
      regionId: true,
      latitude: true,
      longitude: true,
      population: true,
      region: { select: { name: true } },
    },
  });
  return json({ data: cities });
}, "VIEWER");
