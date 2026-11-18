import { describe, expect, it } from "vitest";
import { evaluateEligibility } from "./engine";
import { JURISDICTION_PROFILES } from "./profiles";
import type { EvaluationInput, JurisdictionRules } from "./types";

const approved: Record<string, JurisdictionRules> = Object.fromEntries(
  Object.entries(JURISDICTION_PROFILES).map(([code, profile]) => [
    code,
    { ...profile, status: "APPROVED" as const },
  ]),
);

function base(overrides: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    emailId: "email_1",
    jurisdiction: "SE",
    entityType: "CORPORATE",
    emailStatus: "MX_VALID",
    verificationExpiresAt: new Date(Date.now() + 86_400_000),
    suppressed: false,
    objected: false,
    hasConsent: false,
    hasLawfulBasis: true,
    isRoleAccount: false,
    campaign: {
      senderIdentityConfigured: true,
      unsubscribeConfigured: true,
      lawfulBasisDeclared: true,
    },
    ...overrides,
  };
}

describe("default-deny eligibility", () => {
  it("blocks suppressed addresses before anything else", () => {
    const r = evaluateEligibility(base({ suppressed: true, jurisdiction: null }), approved);
    expect(r.outcome).toBe("SUPPRESSED");
  });

  it("blocks objections", () => {
    const r = evaluateEligibility(base({ objected: true }), approved);
    expect(r.outcome).toBe("SUPPRESSED");
  });

  it("blocks undeliverable addresses", () => {
    const r = evaluateEligibility(base({ emailStatus: "UNDELIVERABLE" }), approved);
    expect(r.outcome).toBe("NOT_ELIGIBLE");
  });

  it("blocks unknown jurisdiction", () => {
    const r = evaluateEligibility(base({ jurisdiction: null }), approved);
    expect(r.outcome).toBe("UNKNOWN_JURISDICTION");
  });

  it("blocks countries without a profile", () => {
    const r = evaluateEligibility(base({ jurisdiction: "FR" }), approved);
    expect(r.outcome).toBe("UNKNOWN_JURISDICTION");
  });

  it("blocks draft profiles", () => {
    const r = evaluateEligibility(base(), JURISDICTION_PROFILES);
    expect(r.outcome).toBe("UNKNOWN_JURISDICTION");
    expect(r.reasons[0]?.code).toBe("PROFILE_NOT_APPROVED");
  });

  it("requires a known recipient type", () => {
    const r = evaluateEligibility(base({ entityType: "UNKNOWN" }), approved);
    expect(r.outcome).toBe("NEEDS_REVIEW");
  });

  it("blocks unverified addresses", () => {
    const r = evaluateEligibility(base({ emailStatus: "SYNTAX_VALID" }), approved);
    expect(r.outcome).toBe("NOT_ELIGIBLE");
    expect(r.requiredActions).toContain("VERIFY_EMAIL");
  });

  it("blocks stale verification", () => {
    const r = evaluateEligibility(
      base({ verificationExpiresAt: new Date(Date.now() - 1000) }),
      approved,
    );
    expect(r.outcome).toBe("NOT_ELIGIBLE");
    expect(r.requiredActions).toContain("REVERIFY_EMAIL");
  });

  it("blocks missing sender identity", () => {
    const r = evaluateEligibility(
      base({ campaign: { senderIdentityConfigured: false, unsubscribeConfigured: true, lawfulBasisDeclared: true } }),
      approved,
    );
    expect(r.outcome).toBe("NOT_ELIGIBLE");
  });

  it("blocks missing unsubscribe", () => {
    const r = evaluateEligibility(
      base({ campaign: { senderIdentityConfigured: true, unsubscribeConfigured: false, lawfulBasisDeclared: true } }),
      approved,
    );
    expect(r.outcome).toBe("NOT_ELIGIBLE");
  });

  it("requires prior consent for Swedish individuals", () => {
    const r = evaluateEligibility(base({ entityType: "INDIVIDUAL" }), approved);
    expect(r.outcome).toBe("NOT_ELIGIBLE");
    expect(r.requiredActions).toContain("RECORD_CONSENT");
  });

  it("allows a consented Swedish individual", () => {
    const r = evaluateEligibility(base({ entityType: "INDIVIDUAL", hasConsent: true }), approved);
    expect(r.outcome).toBe("ELIGIBLE");
  });

  it("requires a documented basis for Swedish corporate recipients", () => {
    const withoutBasis = evaluateEligibility(base({ hasLawfulBasis: false }), approved);
    expect(withoutBasis.outcome).toBe("NOT_ELIGIBLE");
    const withBasis = evaluateEligibility(base(), approved);
    expect(withBasis.outcome).toBe("ELIGIBLE");
  });

  it("treats German corporate mail as consent-only", () => {
    const r = evaluateEligibility(base({ jurisdiction: "DE" }), approved);
    expect(r.outcome).toBe("NOT_ELIGIBLE");
    expect(r.reasons[0]?.code).toBe("CONSENT_REQUIRED");
  });

  it("requires review for German role accounts", () => {
    const r = evaluateEligibility(
      base({ jurisdiction: "DE", isRoleAccount: true, hasConsent: true }),
      approved,
    );
    expect(r.outcome).toBe("NEEDS_REVIEW");
  });

  it("allows UK corporate opt-out with a declared basis", () => {
    const r = evaluateEligibility(base({ jurisdiction: "GB" }), approved);
    expect(r.outcome).toBe("ELIGIBLE");
  });

  it("allows US opt-out mail without prior consent", () => {
    const r = evaluateEligibility(base({ jurisdiction: "US", entityType: "INDIVIDUAL" }), approved);
    expect(r.outcome).toBe("ELIGIBLE");
  });

  it("expires eligible decisions after 24 hours", () => {
    const r = evaluateEligibility(base(), approved);
    expect(r.outcome).toBe("ELIGIBLE");
    expect(r.expirationHours).toBe(24);
    expect(r.ruleSetVersion).toBe("SE-2026.1");
  });
});
