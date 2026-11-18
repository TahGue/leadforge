export type JurisdictionCode = "SE" | "DE" | "GB" | "US";
export type EntityType = "CORPORATE" | "INDIVIDUAL" | "UNKNOWN";
export type ConsentRequirement = "PRIOR_CONSENT" | "LEGITIMATE_INTEREST" | "OPT_OUT";

export type EmailStatus =
  | "DISCOVERED"
  | "SYNTAX_VALID"
  | "DNS_VALID"
  | "MX_VALID"
  | "DELIVERABILITY_UNKNOWN"
  | "RISKY"
  | "UNDELIVERABLE"
  | "SUPPRESSED";

export type Outcome =
  | "ELIGIBLE"
  | "NOT_ELIGIBLE"
  | "NEEDS_REVIEW"
  | "SUPPRESSED"
  | "UNKNOWN_JURISDICTION";

export interface RecipientRules {
  requires: ConsentRequirement;
  existingCustomerException: boolean;
  optOutRequired: boolean;
  roleAccountRequiresReview: boolean;
}

export interface JurisdictionRules {
  code: string;
  version: string;
  status: "DRAFT" | "APPROVED" | "RETIRED";
  regime: string;
  marketingEmail: {
    toIndividual: RecipientRules;
    toCorporate: RecipientRules;
    allowsLegitimateInterest: boolean;
  };
  senderRequirements: ("IDENTITY" | "POSTAL_ADDRESS" | "UNSUBSCRIBE")[];
  unsubscribe: { maxDaysToHonor: number; oneClickRequired: boolean };
  retentionMonths: number;
  notes: string;
}

export interface CampaignContext {
  /** Legal identity + postal address present in the rendered footer. */
  senderIdentityConfigured: boolean;
  unsubscribeConfigured: boolean;
  lawfulBasisDeclared: boolean;
}

export interface EvaluationInput {
  emailId: string;
  jurisdiction: string | null;
  entityType: EntityType;
  emailStatus: EmailStatus;
  verificationExpiresAt: Date | null;
  suppressed: boolean;
  objected: boolean;
  hasConsent: boolean;
  hasLawfulBasis: boolean;
  isRoleAccount: boolean;
  campaign: CampaignContext | null;
  now?: Date;
}

export interface Reason {
  code: string;
  message: string;
  rule?: string;
}

export interface EvaluationResult {
  outcome: Outcome;
  reasons: Reason[];
  requiredActions: string[];
  ruleSetVersion: string;
  expirationHours: number;
  checkedAt: string;
}
