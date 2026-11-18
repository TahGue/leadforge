import type { JurisdictionCode, JurisdictionRules } from "./types";

/**
 * Draft jurisdiction profiles.
 *
 * These encode conservative engineering defaults. They are DATA, not code:
 * enabling marketing in a country requires changing `status` to APPROVED
 * through the approval workflow after qualified legal review.
 */
export const JURISDICTION_PROFILES: Record<JurisdictionCode, JurisdictionRules> = {
  SE: {
    code: "SE",
    version: "2026.1",
    status: "DRAFT",
    regime: "GDPR + Swedish Marketing Act",
    marketingEmail: {
      toIndividual: {
        requires: "PRIOR_CONSENT",
        existingCustomerException: true,
        optOutRequired: true,
        roleAccountRequiresReview: false,
      },
      toCorporate: {
        requires: "LEGITIMATE_INTEREST",
        existingCustomerException: false,
        optOutRequired: true,
        roleAccountRequiresReview: false,
      },
      allowsLegitimateInterest: true,
    },
    senderRequirements: ["IDENTITY", "POSTAL_ADDRESS", "UNSUBSCRIBE"],
    unsubscribe: { maxDaysToHonor: 0, oneClickRequired: true },
    retentionMonths: 24,
    notes:
      "DRAFT. Prior consent generally required for email marketing to natural persons; a role-relevant business contact on a corporate domain may rely on legitimate interest with a recorded assessment and a working opt-out. Verify before enabling.",
  },
  DE: {
    code: "DE",
    version: "2026.1",
    status: "DRAFT",
    regime: "GDPR + UWG",
    marketingEmail: {
      toIndividual: {
        requires: "PRIOR_CONSENT",
        existingCustomerException: true,
        optOutRequired: true,
        roleAccountRequiresReview: false,
      },
      toCorporate: {
        requires: "PRIOR_CONSENT",
        existingCustomerException: false,
        optOutRequired: true,
        roleAccountRequiresReview: true,
      },
      allowsLegitimateInterest: false,
    },
    senderRequirements: ["IDENTITY", "POSTAL_ADDRESS", "UNSUBSCRIBE"],
    unsubscribe: { maxDaysToHonor: 0, oneClickRequired: true },
    retentionMonths: 24,
    notes:
      "DRAFT. German practice expects prior express consent for advertising email, including B2B. Legitimate interest is not accepted as a basis for unsolicited marketing here.",
  },
  GB: {
    code: "GB",
    version: "2026.1",
    status: "DRAFT",
    regime: "UK GDPR + PECR",
    marketingEmail: {
      toIndividual: {
        requires: "PRIOR_CONSENT",
        existingCustomerException: true,
        optOutRequired: true,
        roleAccountRequiresReview: false,
      },
      toCorporate: {
        requires: "OPT_OUT",
        existingCustomerException: false,
        optOutRequired: true,
        roleAccountRequiresReview: false,
      },
      allowsLegitimateInterest: true,
    },
    senderRequirements: ["IDENTITY", "POSTAL_ADDRESS", "UNSUBSCRIBE"],
    unsubscribe: { maxDaysToHonor: 0, oneClickRequired: true },
    retentionMonths: 24,
    notes:
      "DRAFT. PECR treats corporate subscribers differently from individual subscribers; sole traders and some partnerships count as individuals. Verify subscriber status before sending.",
  },
  US: {
    code: "US",
    version: "2026.1",
    status: "DRAFT",
    regime: "CAN-SPAM",
    marketingEmail: {
      toIndividual: {
        requires: "OPT_OUT",
        existingCustomerException: false,
        optOutRequired: true,
        roleAccountRequiresReview: false,
      },
      toCorporate: {
        requires: "OPT_OUT",
        existingCustomerException: false,
        optOutRequired: true,
        roleAccountRequiresReview: false,
      },
      allowsLegitimateInterest: true,
    },
    senderRequirements: ["IDENTITY", "POSTAL_ADDRESS", "UNSUBSCRIBE"],
    unsubscribe: { maxDaysToHonor: 10, oneClickRequired: false },
    retentionMonths: 24,
    notes:
      "DRAFT. Opt-out regime for commercial email, including B2B: accurate headers, physical postal address, and a working unsubscribe honoured within 10 business days.",
  },
};

export function getProfile(
  code: string | null | undefined,
  catalog: Record<string, JurisdictionRules> = JURISDICTION_PROFILES,
): JurisdictionRules | null {
  if (!code) return null;
  return catalog[code.toUpperCase()] ?? null;
}
