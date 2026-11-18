import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { json, withAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

/** The current taxonomy. ?tree=1 returns sectors with their subsectors nested. */
export const GET = withAuth(async (request: NextRequest) => {
  const tree = new URL(request.url).searchParams.get("tree") === "1";
  const version = await prisma.industryTaxonomyVersion.findFirst({ where: { isCurrent: true } });
  if (!version) return json({ data: [], version: null });
  const industries = await prisma.industry.findMany({
    where: { versionId: version.id, isActive: true, ...(tree ? {} : { parentId: null }) },
    orderBy: [{ level: "asc" }, { name: "asc" }],
    include: {
      externalCodes: { select: { scheme: true, code: true } },
      _count: { select: { children: true, companies: true } },
    },
  });
  if (!tree) return json({ data: industries, version: { taxonomy: version.taxonomy, version: version.version } });
  const byParent = new Map<string | null, typeof industries>();
  for (const industry of industries) {
    const list = byParent.get(industry.parentId) ?? [];
    list.push(industry);
    byParent.set(industry.parentId, list);
  }
  const data = (byParent.get(null) ?? []).map((sector) => ({ ...sector, children: byParent.get(sector.id) ?? [] }));
  return json({ data, version: { taxonomy: version.taxonomy, version: version.version } });
}, "VIEWER");
