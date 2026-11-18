import type { NextRequest } from "next/server";
import { prisma, type Prisma } from "@leadforge/database";
import { ApiError, parseBody, sourcePolicyUpdate } from "@leadforge/shared";
import { actorUserId, json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ id: string }>(async (_request: NextRequest, session, params) => {
  const source = await prisma.source.findFirst({
    where: { id: params.id, organizationId: session.organization.id },
    include: { _count: { select: { crawlJobs: true, discoveryRuns: true, observations: true } } },
  });
  if (!source) throw new ApiError(404, "NOT_FOUND", "Source not found");
  return json({ data: source });
}, "VIEWER");

/**
 * Policy review (spec 10). Approval needs the terms URL, notes on permitted use,
 * and an explicit statement that automated access is allowed. Any policy change
 * bumps policyVersion so observations can be traced to the policy in force.
 */
export const PATCH = withAuth<{ id: string }>(async (request, session, params) => {
  const input = await parseBody(request, sourcePolicyUpdate);
  const source = await prisma.source.findFirst({ where: { id: params.id, organizationId: session.organization.id } });
  if (!source) throw new ApiError(404, "NOT_FOUND", "Source not found");

  const approving = input.policyStatus === "APPROVED" || input.permitted === true;
  const tosUrl = input.tosUrl ?? source.tosUrl;
  const notes = input.policyNotes ?? source.policyNotes;
  const permittedUse = input.permittedUse ?? source.permittedUse;
  const automated = input.automatedAccessAllowed ?? source.automatedAccessAllowed;
  if (approving && source.sourceType !== "IMPORT") {
    if (!tosUrl || !notes || !permittedUse) {
      throw new ApiError(400, "VALIDATION_ERROR", "Approving a source requires a terms URL, policy notes and permitted use");
    }
    if (!automated) {
      throw new ApiError(400, "VALIDATION_ERROR", "Approving a source requires confirming that automated access is permitted");
    }
  }

  const policyChanged =
    input.policyStatus !== undefined ||
    input.permitted !== undefined ||
    input.automatedAccessAllowed !== undefined ||
    input.commercialReuseAllowed !== undefined ||
    input.permittedUse !== undefined ||
    input.retentionDays !== undefined;

  const status = input.policyStatus ?? (input.permitted === true ? "APPROVED" : input.permitted === false ? "RESTRICTED" : source.policyStatus);
  const data: Prisma.SourceUpdateInput = {
    policyStatus: status,
    permitted: status === "APPROVED" ? (input.permitted ?? true) : false,
    enabled: input.enabled,
    policyNotes: notes,
    tosUrl,
    licenceName: input.licenceName,
    licenceUrl: input.licenceUrl,
    permittedUse,
    attribution: input.attribution,
    automatedAccessAllowed: input.automatedAccessAllowed,
    commercialReuseAllowed: input.commercialReuseAllowed,
    retentionDays: input.retentionDays,
    rateLimitJson: input.rateLimitJson as Prisma.InputJsonValue | undefined,
    config: input.config as Prisma.InputJsonValue | undefined,
    ...(policyChanged
      ? { policyVersion: { increment: 1 }, tosReviewedAt: new Date(), reviewedBy: actorUserId(session) ?? session.user.id }
      : {}),
  };
  const updated = await prisma.source.update({ where: { id: source.id }, data });

  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: approving ? "source.approve" : policyChanged ? "source.policy_update" : "source.update",
    entity: "Source",
    entityId: updated.id,
    metadata: { policyStatus: updated.policyStatus, policyVersion: updated.policyVersion },
  });
  return json({ data: updated });
}, "ADMIN");
