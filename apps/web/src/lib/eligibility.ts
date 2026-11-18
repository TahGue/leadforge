import { prisma } from "@leadforge/database";
import {
  evaluateForCampaign,
  type CampaignEvaluationOptions,
  type EvaluationWithId,
} from "@leadforge/database";
import { ApiError } from "@leadforge/shared";
import { env } from "./env";

export interface EvaluateOptions {
  organizationId: string;
  emailId: string;
  campaignId?: string | null;
  purpose?: string;
}

export type { EvaluationWithId };

/**
 * Deployment-specific wrapper: contributes the sender identity and
 * unsubscribe configuration facts the pure engine needs.
 */
export async function evaluateEmailForCampaign(
  options: EvaluateOptions,
): Promise<EvaluationWithId> {
  const evaluationOptions: CampaignEvaluationOptions = {
    ...options,
    senderIdentityConfigured: Boolean(env.smtp.from && env.postalAddress),
    unsubscribeConfigured: Boolean(env.unsubscribeKey),
  };

  try {
    const evaluation = await evaluateForCampaign(prisma, evaluationOptions);

    await prisma.domainEvent.create({
      data: {
        organizationId: options.organizationId,
        type: "eligibility.evaluated",
        aggregateType: "EmailAddress",
        aggregateId: options.emailId,
        payload: {
          outcome: evaluation.outcome,
          ruleSetVersion: evaluation.ruleSetVersion,
          campaignId: options.campaignId ?? null,
        },
      },
    });

    return evaluation;
  } catch (error) {
    if ((error as Error).message === "EMAIL_NOT_FOUND") {
      throw new ApiError(404, "NOT_FOUND", "Email not found");
    }
    if ((error as Error).message === "CAMPAIGN_NOT_FOUND") {
      throw new ApiError(404, "NOT_FOUND", "Campaign not found");
    }
    throw error;
  }
}
