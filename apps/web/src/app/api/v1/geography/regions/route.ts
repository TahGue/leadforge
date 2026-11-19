import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { ApiError } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (request: NextRequest) => {
  const country = new URL(request.url).searchParams.get("country")?.toUpperCase();
  if (!country) throw new ApiError(400, "VALIDATION_ERROR", "country is required");
  const regions = await prisma.adminRegion.findMany({
    where: { countryIso2: country },
    orderBy: { name: "asc" },
    select: { id: true, code: true, isoCode: true, name: true, countryIso2: true, _count: { select: { cities: true } } },
  });
  return json({ data: regions });
}, "VIEWER");
