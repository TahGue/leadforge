import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { scanDuplicates } from "@leadforge/pipeline";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const companySelect = {
  id: true,
  name: true,
  countryCode: true,
  registrationNumber: true,
  website: true,
  createdAt: true,
  domains: { include: { domain: { select: { domain: true } } } },
  _count: { select: { contacts: true, evidence: true } },
} as const;

export const GET = withAuth(async (request: NextRequest, session) => {
  const status = new URL(request.url).searchParams.get("status")?.toUpperCase() ?? "OPEN";
  const rows = await prisma.companyDuplicateCandidate.findMany({
    where: { organizationId: session.organization.id, status: status as "OPEN" | "MERGED" | "DISMISSED" },
    orderBy: { score: "desc" },
    take: 200,
    include: { companyA: { select: companySelect }, companyB: { select: companySelect } },
  });
  return json({ data: rows });
}, "VIEWER");

/** Scan for new duplicate signals (name+country, shared role phone). */
export const POST = withAuth(async (_request, session) => {
  const added = await scanDuplicates(session.organization.id);
  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "duplicates.scan",
    entity: "CompanyDuplicateCandidate",
    metadata: { added },
  });
  return json({ data: { added } });
}, "ANALYST");
