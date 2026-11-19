import { prisma } from "@leadforge/database";
import { ApiError } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Every field's provenance: page evidence from crawls plus source observations. */
export const GET = withAuth<{ id: string }>(async (_request, session, params) => {
  const company = await prisma.company.findFirst({
    where: { id: params.id, organizationId: session.organization.id },
    select: { id: true, confidence: true, confidenceDetail: true },
  });
  if (!company) throw new ApiError(404, "NOT_FOUND", "Company not found");
  const [evidence, observations, industries, locations] = await Promise.all([
    prisma.sourceEvidence.findMany({
      where: { companyId: company.id },
      orderBy: { observedAt: "desc" },
      take: 500,
      include: { source: { select: { name: true } } },
    }),
    prisma.sourceObservation.findMany({
      where: { companyId: company.id },
      orderBy: { observedAt: "desc" },
      take: 500,
      include: { source: { select: { name: true, licenceName: true } } },
    }),
    prisma.companyIndustry.findMany({
      where: { companyId: company.id },
      include: { industry: { select: { name: true, code: true } } },
    }),
    prisma.companyLocation.findMany({ where: { companyId: company.id }, include: { city: { select: { name: true } } } }),
  ]);
  return json({ data: { confidence: company.confidence, confidenceDetail: company.confidenceDetail, evidence, observations, industries, locations } });
}, "VIEWER");
