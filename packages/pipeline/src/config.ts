/** Runtime configuration shared by the web app and the worker. */

export const features = {
  /** Campaigns and delivery are frozen until Phase 9 legal review (ADR-0020). */
  get campaigns(): boolean {
    return process.env.FEATURE_CAMPAIGNS === "true";
  },
};

export const limits = {
  /** Projects above this company cap need an explicit human approval before start (spec 5.7). */
  get highVolumeCompanies(): number {
    return Number(process.env.DISCOVERY_HIGH_VOLUME_THRESHOLD ?? 5000);
  },
  get verificationTtlDays(): number {
    return Number(process.env.VERIFICATION_TTL_DAYS ?? 90);
  },
  get companyFreshnessDays(): number {
    return Number(process.env.COMPANY_FRESHNESS_DAYS ?? 180);
  },
};

export const retention = {
  get rejectedCandidatesDays(): number {
    return Number(process.env.RETENTION_EXTRACTION_CANDIDATES_DAYS ?? 180);
  },
  get auditDays(): number {
    return Number(process.env.RETENTION_AUDIT_DAYS ?? 730);
  },
  get stagingDays(): number {
    return Number(process.env.RETENTION_STAGING_DAYS ?? 90);
  },
};
