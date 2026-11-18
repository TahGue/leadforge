import { prisma } from "@leadforge/database";
import { mergeCompanies } from "@leadforge/pipeline";
import { ApiError, duplicateDecision, parseBody } from "@leadforge/shared";
import { actorUserId, json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const POST = withAuth<{ id: string }>(async (request, session, params) => {
  const input = await parseBody(request, duplicateDecision);
  const pair = await prisma.companyDuplicateCandidate.findFirst({
    where: { id: params.id, organizationId: session.organization.id },
  });
  if (!pair) throw new ApiError(404, "NOT_FOUND", "Duplicate candidate not found");
  if (pair.status !== "OPEN") throw new ApiError(409, "CONFLICT", "Already decided");
  const reviewer = actorUserId(session);
  if (input.action === "DISMISS") {
    await prisma.companyDuplicateCandidate.update({
      where: { id: pair.id },
      data: { status: "DISMISSED", reviewedBy: reviewer, reviewedAt: new Date() },
    });
  } else {
    const keep = input.keep === "A" ? pair.companyAId : pair.companyBId;
    const drop = input.keep === "A" ? pair.companyBId : pair.companyAId;
    await mergeCompanies(session.organization.id, keep, drop, reviewer);
    await prisma.companyDuplicateCandidate.update({
      where: { id: pair.id },
      data: { status: "MERGED", reviewedBy: reviewer, reviewedAt: new Date() },
    });
  }
  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: `duplicates.${input.action.toLowerCase()}`,
    entity: "CompanyDuplicateCandidate",
    entityId: pair.id,
    metadata: { keep: input.keep, companyAId: pair.companyAId, companyBId: pair.companyBId },
  });
  return json({ data: { id: pair.id, action: input.action } });
}, "ANALYST");
