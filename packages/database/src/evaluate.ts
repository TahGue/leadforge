import type { PrismaClient } from "@prisma/client";
import {
  JURISDICTION_PROFILES,
  evaluateEligibility,
  type EntityType,
  type EvaluationResult,
  type JurisdictionRules,
} from "@leadforge/compliance";
import type { Prisma } from "@prisma/client";

export interface CampaignEvaluationOptions {
  organizationId: string;
  emailId: string;
  campaignId?: string | null;
  purpose?: string;
  senderIdentityConfigured: boolean;
  unsubscribeConfigured: boolean;
}

export interface EvaluationWithId extends EvaluationResult {
  decisionId: string;
  emailId: string;
  campaignId: string | null;
  entityType: EntityType;
  jurisdiction: string | null;
}

const COUNTRY_TO_JURISDICTION: Record<string, string> = {
  SE: "SE",
  DE: "DE",
  GB: "GB",
  UK: "GB",
  US: "US",
};

function resolveJurisdiction(countryCode: string | null | undefined): string | null {
  if (!countryCode) return null;
  return COUNTRY_TO_JURISDICTION[countryCode.toUpperCase()] ?? null;
}

export async function loadProfileCatalog(
  client: PrismaClient | Prisma.TransactionClient,
): Promise<Record<string, JurisdictionRules>> {
  const rows = await client.jurisdictionProfile.findMany({ where: { status: "APPROVED" } });
  const catalog: Record<string, JurisdictionRules> = { ...JURISDICTION_PROFILES };
  for (const row of rows) {
    const rules = row.rules as unknown as JurisdictionRules;
    if (rules?.marketingEmail) catalog[row.code] = { ...rules, status: "APPROVED" };
  }
  return catalog;
}

/**
 * Single implementation of the eligibility decision used by both the API and
 * the sending worker. Callers pass deployment facts (sender identity and
 * unsubscribe availability) so this module stays environment-agnostic.
 */
export async function evaluateForCampaign(
  client: PrismaClient,
  options: CampaignEvaluationOptions,
): Promise<EvaluationWithId> {
  const email = await client.emailAddress.findUnique({
    where: { id: options.emailId },
    include: {
      contacts: { include: { contact: { include: { company: true } } } },
      consents: true,
      lawfulBases: true,
      verifications: { orderBy: { checkedAt: "desc" }, take: 1 },
    },
  });
  if (!email) throw new Error("EMAIL_NOT_FOUND");

  const contact = email.contacts[0]?.contact;
  const company = contact?.company ?? null;

  const campaign = options.campaignId
    ? await client.campaign.findFirst({
        where: { id: options.campaignId, organizationId: options.organizationId },
      })
    : null;
  if (options.campaignId && !campaign) throw new Error("CAMPAIGN_NOT_FOUND");

  const [globalSuppression, orgSuppression] = await Promise.all([
    client.suppressionEntry.findFirst({
      where: { emailNormalized: email.normalized, organizationId: null, liftedAt: null },
    }),
    client.suppressionEntry.findFirst({
      where: {
        emailNormalized: email.normalized,
        organizationId: options.organizationId,
        liftedAt: null,
      },
    }),
  ]);

  const purpose = options.purpose ?? "MARKETING";
  const hasConsent = email.consents.some((c) => !c.withdrawnAt && c.purpose === purpose);
  const hasLawfulBasis = email.lawfulBases.length > 0;
  const objected = email.consents.some((c) => c.withdrawnAt !== null);

  const jurisdiction = resolveJurisdiction(company?.countryCode ?? null);
  const entityType: EntityType = contact
    ? contact.type === "PERSON"
      ? "INDIVIDUAL"
      : "CORPORATE"
    : "UNKNOWN";

  const catalog = await loadProfileCatalog(client);
  const evaluation = evaluateEligibility(
    {
      emailId: email.id,
      jurisdiction,
      entityType,
      emailStatus: email.status,
      verificationExpiresAt: email.verificationExpiresAt,
      suppressed: Boolean(globalSuppression || orgSuppression),
      objected,
      hasConsent,
      hasLawfulBasis,
      isRoleAccount: email.isRoleAccount,
      campaign: campaign
        ? {
            senderIdentityConfigured: options.senderIdentityConfigured,
            unsubscribeConfigured: options.unsubscribeConfigured,
            lawfulBasisDeclared: Boolean(campaign.lawfulBasis),
          }
        : null,
    },
    catalog,
  );

  const expiresAt = new Date(Date.now() + evaluation.expirationHours * 3_600_000);
  const contextHash = [
    email.id,
    campaign?.id ?? "none",
    jurisdiction ?? "none",
    entityType,
    email.status,
    hasConsent,
    hasLawfulBasis,
    evaluation.ruleSetVersion,
  ].join(":");

  const decision = await client.eligibilityDecision.create({
    data: {
      organizationId: options.organizationId,
      emailId: email.id,
      campaignId: campaign?.id ?? null,
      contextHash,
      ruleSetVersion: evaluation.ruleSetVersion,
      outcome: evaluation.outcome,
      reasons: evaluation.reasons as unknown as Prisma.InputJsonValue,
      requiredActions: evaluation.requiredActions as unknown as Prisma.InputJsonValue,
      expiresAt,
    },
  });

  return {
    ...evaluation,
    decisionId: decision.id,
    emailId: email.id,
    campaignId: campaign?.id ?? null,
    entityType,
    jurisdiction,
  };
}
