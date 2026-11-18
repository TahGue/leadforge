import { prisma } from "@leadforge/database";
import { ApiError } from "@leadforge/shared";
import { evaluateEmailForCampaign } from "./eligibility";

export interface SegmentDefinition {
  countryCodes: string[];
  industries: string[];
  contactTypes: ("PERSON" | "GENERIC_BUSINESS")[];
  minConfidence: number;
  onlyMxValid: boolean;
}

export async function buildRecipients(
  campaignId: string,
  organizationId: string,
): Promise<{ total: number; eligible: number; excluded: number; byOutcome: Record<string, number> }> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
  });
  if (!campaign) throw new ApiError(404, "NOT_FOUND", "Campaign not found");

  const segment = campaign.segmentDefinition as unknown as SegmentDefinition;

  const contacts = await prisma.contact.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ...(segment.contactTypes?.length ? { type: { in: segment.contactTypes } } : {}),
      ...(segment.minConfidence ? { confidence: { gte: segment.minConfidence } } : {}),
      company: {
        deletedAt: null,
        ...(segment.countryCodes?.length ? { countryCode: { in: segment.countryCodes } } : {}),
        ...(segment.industries?.length ? { industry: { in: segment.industries } } : {}),
      },
    },
    include: { emails: { include: { email: true } } },
    take: 2000,
  });

  const seen = new Set<string>();
  const candidates: { emailId: string; address: string }[] = [];
  for (const contact of contacts) {
    for (const link of contact.emails) {
      if (seen.has(link.emailId)) continue;
      if (segment.onlyMxValid && !["MX_VALID", "DELIVERABILITY_UNKNOWN"].includes(link.email.status)) {
        continue;
      }
      seen.add(link.emailId);
      candidates.push({ emailId: link.emailId, address: link.email.normalized });
    }
  }

  const byOutcome: Record<string, number> = {};
  let eligible = 0;

  for (const candidate of candidates) {
    const evaluation = await evaluateEmailForCampaign({
      organizationId,
      emailId: candidate.emailId,
      campaignId,
    });
    byOutcome[evaluation.outcome] = (byOutcome[evaluation.outcome] ?? 0) + 1;
    if (evaluation.outcome === "ELIGIBLE") eligible += 1;

    await prisma.campaignRecipient.upsert({
      where: {
        campaignId_emailId: { campaignId, emailId: candidate.emailId },
      },
      create: {
        campaignId,
        emailId: candidate.emailId,
        emailSnapshot: candidate.address,
        status:
          evaluation.outcome === "ELIGIBLE"
            ? "PENDING"
            : evaluation.outcome === "SUPPRESSED"
              ? "SUPPRESSED"
              : "EXCLUDED",
        eligibilityDecisionId: evaluation.decisionId,
        error:
          evaluation.outcome === "ELIGIBLE"
            ? null
            : evaluation.reasons.map((r) => r.code).join(","),
      },
      update: {
        status:
          evaluation.outcome === "ELIGIBLE"
            ? "PENDING"
            : evaluation.outcome === "SUPPRESSED"
              ? "SUPPRESSED"
              : "EXCLUDED",
        eligibilityDecisionId: evaluation.decisionId,
        error:
          evaluation.outcome === "ELIGIBLE"
            ? null
            : evaluation.reasons.map((r) => r.code).join(","),
      },
    });
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: campaign.status === "DRAFT" ? "REVIEW" : campaign.status },
  });

  return {
    total: candidates.length,
    eligible,
    excluded: candidates.length - eligible,
    byOutcome,
  };
}

export async function recipientCounts(campaignId: string) {
  const grouped = await prisma.campaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: true,
  });
  return Object.fromEntries(grouped.map((g) => [g.status, g._count]));
}
