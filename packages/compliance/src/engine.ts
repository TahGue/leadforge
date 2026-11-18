import { JURISDICTION_PROFILES, getProfile } from "./profiles";
import type {
  EvaluationInput,
  EvaluationResult,
  JurisdictionRules,
  Outcome,
  Reason,
} from "./types";

const DECISION_TTL_HOURS = 24;

function result(
  outcome: Outcome,
  ruleSetVersion: string,
  reasons: Reason[],
  requiredActions: string[] = [],
  checkedAt = new Date(),
): EvaluationResult {
  return {
    outcome,
    reasons,
    requiredActions,
    ruleSetVersion,
    expirationHours: DECISION_TTL_HOURS,
    checkedAt: checkedAt.toISOString(),
  };
}

const VERIFIED_STATUSES = new Set(["MX_VALID", "DELIVERABILITY_UNKNOWN"]);

/**
 * Pure, synchronous, default-deny eligibility evaluation.
 *
 * Order matters: suppression and objections always win, unknown jurisdiction
 * always blocks, and no rule can upgrade a blocked decision.
 */
export function evaluateEligibility(
  input: EvaluationInput,
  catalog: Record<string, JurisdictionRules> = JURISDICTION_PROFILES,
): EvaluationResult {
  const now = input.now ?? new Date();
  const profile = getProfile(input.jurisdiction, catalog);
  const version = profile ? `${profile.code}-${profile.version}` : "unknown";

  // 1. Suppression and objections are absolute.
  if (input.suppressed) {
    return result("SUPPRESSED", version, [
      { code: "SUPPRESSED", message: "Address is on the suppression list." },
    ]);
  }
  if (input.objected) {
    return result("SUPPRESSED", version, [
      { code: "OBJECTION", message: "The recipient objected to marketing processing." },
    ]);
  }

  // 2. Undeliverable addresses are never eligible.
  if (input.emailStatus === "UNDELIVERABLE" || input.emailStatus === "SUPPRESSED") {
    return result("NOT_ELIGIBLE", version, [
      { code: "UNDELIVERABLE", message: "Address is known to be undeliverable." },
    ]);
  }

  // 3. A campaign context is required: eligibility is purpose-bound.
  if (!input.campaign) {
    return result("NEEDS_REVIEW", version, [
      { code: "NO_PURPOSE", message: "No campaign or purpose supplied for this evaluation." },
    ]);
  }

  // 4. Structural sender requirements.
  if (!input.campaign.senderIdentityConfigured) {
    return result("NOT_ELIGIBLE", version, [
      {
        code: "SENDER_IDENTITY_MISSING",
        message: "Sender legal identity and postal address are not configured.",
        rule: "sender_requirements",
      },
    ]);
  }
  if (!input.campaign.unsubscribeConfigured) {
    return result("NOT_ELIGIBLE", version, [
      {
        code: "UNSUBSCRIBE_MISSING",
        message: "A working unsubscribe mechanism is not configured.",
        rule: "unsubscribe",
      },
    ]);
  }

  // 5. Jurisdiction must resolve to an approved profile.
  if (!input.jurisdiction) {
    return result("UNKNOWN_JURISDICTION", version, [
      { code: "JURISDICTION_UNKNOWN", message: "Recipient jurisdiction could not be resolved." },
    ]);
  }
  if (!profile) {
    return result("UNKNOWN_JURISDICTION", version, [
      {
        code: "NO_PROFILE",
        message: `No jurisdiction profile exists for ${input.jurisdiction}.`,
      },
    ]);
  }
  if (profile.status !== "APPROVED") {
    return result("UNKNOWN_JURISDICTION", version, [
      {
        code: "PROFILE_NOT_APPROVED",
        message: `Jurisdiction profile ${version} is ${profile.status}; sending is disabled.`,
        rule: "profile_status",
      },
    ]);
  }

  // 6. Recipient type must be known.
  if (input.entityType === "UNKNOWN") {
    return result("NEEDS_REVIEW", version, [
      {
        code: "ENTITY_TYPE_UNKNOWN",
        message: "Could not determine whether the recipient is a company or an individual.",
      },
    ]);
  }

  // 7. Verification must be current.
  if (!VERIFIED_STATUSES.has(input.emailStatus)) {
    return result(
      "NOT_ELIGIBLE",
      version,
      [{ code: "NOT_VERIFIED", message: "Email has not passed domain/MX verification.", rule: "verification" }],
      ["VERIFY_EMAIL"],
    );
  }
  if (!input.verificationExpiresAt || input.verificationExpiresAt.getTime() <= now.getTime()) {
    return result(
      "NOT_ELIGIBLE",
      version,
      [{ code: "STALE_VERIFICATION", message: "Verification is expired and must be re-run.", rule: "freshness" }],
      ["REVERIFY_EMAIL"],
    );
  }

  // 8. Recipient-type rules.
  const rules =
    input.entityType === "CORPORATE"
      ? profile.marketingEmail.toCorporate
      : profile.marketingEmail.toIndividual;

  if (input.isRoleAccount && rules.roleAccountRequiresReview) {
    return result("NEEDS_REVIEW", version, [
      {
        code: "ROLE_ACCOUNT_REVIEW",
        message: "Generic role account requires manual review in this jurisdiction.",
        rule: "role_account",
      },
    ]);
  }

  // 9. Consent / basis requirements.
  if (rules.requires === "PRIOR_CONSENT") {
    if (!input.hasConsent) {
      return result(
        "NOT_ELIGIBLE",
        version,
        [
          {
            code: "CONSENT_REQUIRED",
            message: "Prior consent is required for this recipient type in this jurisdiction.",
            rule: "consent",
          },
        ],
        ["RECORD_CONSENT"],
      );
    }
  }

  if (rules.requires === "LEGITIMATE_INTEREST") {
    if (!profile.marketingEmail.allowsLegitimateInterest) {
      return result("NOT_ELIGIBLE", version, [
        {
          code: "BASIS_NOT_ACCEPTED",
          message: "This jurisdiction does not accept legitimate interest for marketing email.",
          rule: "basis",
        },
      ]);
    }
    if (!input.hasLawfulBasis || !input.campaign.lawfulBasisDeclared) {
      return result(
        "NOT_ELIGIBLE",
        version,
        [
          {
            code: "NO_LAWFUL_BASIS",
            message: "A documented lawful basis (LIA) is required before sending.",
            rule: "lawful_basis",
          },
        ],
        ["RECORD_LAWFUL_BASIS"],
      );
    }
  }

  if (rules.optOutRequired && !input.campaign.unsubscribeConfigured) {
    return result("NOT_ELIGIBLE", version, [
      { code: "OPT_OUT_REQUIRED", message: "An opt-out mechanism is mandatory.", rule: "opt_out" },
    ]);
  }

  return result("ELIGIBLE", version, [
    {
      code: "ELIGIBLE",
      message: `Eligible under ${profile.regime} (${version}).`,
    },
  ]);
}

export function ruleSetVersionFor(profile: JurisdictionRules | null): string {
  return profile ? `${profile.code}-${profile.version}` : "unknown";
}
