import { z } from "zod";

export const PAGE_SIZE_DEFAULT = 50;
export const PAGE_SIZE_MAX = 200;

export const cursorQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export const companyCreate = z.object({
  name: z.string().min(1).max(300),
  legalName: z.string().max(300).optional(),
  description: z.string().max(5000).optional(),
  countryCode: z.string().length(2).toUpperCase().optional(),
  /** Free-text location; resolved to geography IDs when possible. */
  city: z.string().max(120).optional(),
  cityId: z.string().optional(),
  regionId: z.string().optional(),
  industryLabel: z.string().max(120).optional(),
  industryIds: z.array(z.string()).max(10).default([]),
  registrationNumber: z.string().max(40).optional(),
  employeeRange: z.string().max(40).optional(),
  website: z.string().url().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
});

export const companyUpdate = companyCreate.partial().extend({
  reviewStatus: z.enum(["UNREVIEWED", "NEEDS_REVIEW", "REVIEWED"]).optional(),
});

export const contactCreate = z.object({
  companyId: z.string().min(1),
  type: z.enum(["PERSON", "GENERIC_BUSINESS"]).default("PERSON"),
  category: z
    .enum(["GENERAL", "SALES", "PROCUREMENT", "MANAGEMENT", "PRESS", "SUPPORT", "CAREERS", "NAMED", "OTHER"])
    .default("GENERAL"),
  firstName: z.string().max(120).optional(),
  lastName: z.string().max(120).optional(),
  fullName: z.string().max(200).optional(),
  jobTitle: z.string().max(200).optional(),
  department: z.string().max(120).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  sourceUrl: z.string().url(),
});

export const SOURCE_ADAPTERS = ["domain_list", "open_dataset", "osm_overpass"] as const;

export const sourceCreate = z.object({
  name: z.string().min(1).max(200),
  sourceType: z.enum(["WEBSITE", "DIRECTORY", "SEARCH", "REGISTRY", "IMPORT", "MANUAL", "DATASET"]),
  adapter: z.enum(SOURCE_ADAPTERS).optional(),
  baseUrl: z.string().url().optional(),
  policyNotes: z.string().max(4000).optional(),
  tosUrl: z.string().url().optional(),
  licenceName: z.string().max(200).optional(),
  licenceUrl: z.string().url().optional(),
  attribution: z.string().max(500).optional(),
  config: z.record(z.string(), z.unknown()).default({}),
});

/** A policy review. Approval requires the reviewer to state the permissions explicitly. */
export const sourcePolicyUpdate = z.object({
  permitted: z.boolean().optional(),
  policyStatus: z.enum(["UNREVIEWED", "APPROVED", "RESTRICTED", "DENIED"]).optional(),
  enabled: z.boolean().optional(),
  policyNotes: z.string().max(4000).optional(),
  tosUrl: z.string().url().optional(),
  licenceName: z.string().max(200).optional(),
  licenceUrl: z.string().url().optional(),
  permittedUse: z.string().max(4000).optional(),
  attribution: z.string().max(500).optional(),
  automatedAccessAllowed: z.boolean().optional(),
  commercialReuseAllowed: z.boolean().optional(),
  retentionDays: z.number().int().min(1).max(3650).nullable().optional(),
  rateLimitJson: z
    .object({ requestsPerMinute: z.number().int().min(1).max(600).optional() })
    .optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const filterMode = z.enum(["INCLUDE", "EXCLUDE"]);
export const CONTACT_CATEGORIES = [
  "GENERAL", "SALES", "PROCUREMENT", "MANAGEMENT", "PRESS", "SUPPORT", "CAREERS", "NAMED", "OTHER",
] as const;
export const GEOGRAPHIC_MODES = ["CITY", "REGION", "COUNTRY", "CONTINENT", "WORLDWIDE", "CUSTOM"] as const;

const LOCATION_REQUIRES = {
  CONTINENT: "continentCode",
  COUNTRY: "countryIso2",
  REGION: "regionId",
  CITY: "cityId",
  POSTAL: "postalPrefix",
  POINT: "latitude",
} as const;

export const discoveryLocationInput = z
  .object({
    mode: filterMode.default("INCLUDE"),
    level: z.enum(["CONTINENT", "COUNTRY", "REGION", "CITY", "POSTAL", "POINT"]),
    continentCode: z.string().length(2).toUpperCase().optional(),
    countryIso2: z.string().length(2).toUpperCase().optional(),
    regionId: z.string().min(1).optional(),
    cityId: z.string().min(1).optional(),
    postalPrefix: z.string().min(1).max(12).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    radiusKm: z.number().min(0.1).max(1000).optional(),
    includeNearby: z.boolean().default(false),
  })
  .superRefine((loc, ctx) => {
    const field = LOCATION_REQUIRES[loc.level];
    if (loc[field] === undefined) {
      ctx.addIssue({ code: "custom", message: `${loc.level} location requires ${field}` });
    }
    if (loc.level === "POSTAL" && !loc.countryIso2) {
      ctx.addIssue({ code: "custom", message: "POSTAL location requires countryIso2" });
    }
    if (loc.level === "POINT" && (loc.longitude === undefined || loc.radiusKm === undefined)) {
      ctx.addIssue({ code: "custom", message: "POINT location requires longitude and radiusKm" });
    }
  });

export const discoveryProjectSettings = z.object({
  locationScope: z.enum(["HEADQUARTERS", "ANY_BRANCH", "ALL"]).default("ANY_BRANCH"),
  minLocationConfidence: z.number().min(0).max(1).default(0),
  company: z
    .object({
      employeeRanges: z.array(z.string().max(40)).default([]),
      revenueRanges: z.array(z.string().max(40)).default([]),
      legalForms: z.array(z.string().max(60)).default([]),
      operatingStatuses: z.array(z.enum(["ACTIVE", "INACTIVE", "NEWLY_REGISTERED", "UNKNOWN"])).default([]),
      foundedFrom: z.number().int().min(1600).max(2100).optional(),
      foundedTo: z.number().int().min(1600).max(2100).optional(),
      ownership: z.array(z.enum(["INDEPENDENT", "SUBSIDIARY", "FRANCHISE"])).default([]),
      domainRequired: z.boolean().default(true),
      websiteReachability: z.enum(["ANY", "REACHABLE", "UNREACHABLE", "UNKNOWN"]).default("ANY"),
      httpsRequired: z.boolean().default(false),
      socialProfilesRequired: z.boolean().default(false),
      descriptionRequired: z.boolean().default(false),
    })
    .prefault({}),
  contacts: z
    .object({
      categories: z.array(z.enum(CONTACT_CATEGORIES)).default(["GENERAL", "SALES"]),
      roleMode: z.enum(["ROLE_ONLY", "NAMED_ONLY", "BOTH"]).default("BOTH"),
      requirePhone: z.boolean().default(false),
      requireContactForm: z.boolean().default(false),
      excludeFreeMail: z.boolean().default(true),
      requireEvidence: z.boolean().default(true),
      requireSyntaxValid: z.boolean().default(true),
      requireMxValid: z.boolean().default(false),
      minConfidence: z.number().min(0).max(1).default(0.5),
    })
    .prefault({}),
  website: z
    .object({
      presence: z.enum(["ANY", "EXISTS", "ABSENT"]).default("ANY"),
      technologies: z.array(z.string().max(60)).default([]),
      requireContactPage: z.boolean().default(false),
      requireCareersPage: z.boolean().default(false),
      requireShop: z.boolean().default(false),
    })
    .prefault({}),
  language: z
    .object({
      websiteLanguages: z.array(z.string().min(2).max(8)).default([]),
      allowUnknown: z.boolean().default(true),
      minConfidence: z.number().min(0).max(1).default(0),
    })
    .prefault({}),
  quality: z
    .object({
      minSourceObservations: z.number().int().min(0).max(10).default(1),
      officialWebsiteRequired: z.boolean().default(false),
      maxRecordAgeDays: z.number().int().min(1).max(3650).optional(),
      requireReviewed: z.boolean().default(false),
      excludeDuplicates: z.boolean().default(true),
    })
    .prefault({}),
  exclusions: z
    .object({
      domains: z.array(z.string().max(253)).default([]),
      keywords: z.array(z.string().max(120)).default([]),
      tags: z.array(z.string().max(40)).default(["customer", "competitor", "contacted"]),
      excludePreviouslyProcessed: z.boolean().default(false),
      excludeSuppressed: z.boolean().default(true),
      sourceDomains: z.array(z.string().max(253)).default([]),
    })
    .prefault({}),
  crawl: z
    .object({
      requestsPerDomainPerMinute: z.number().int().min(1).max(60).default(6),
      globalConcurrency: z.number().int().min(1).max(32).default(4),
      perSourceConcurrency: z.number().int().min(1).max(8).default(1),
      timeoutSeconds: z.number().int().min(5).max(120).default(20),
      retryCount: z.number().int().min(0).max(5).default(2),
      allowedUrlPatterns: z.array(z.string().max(200)).default([]),
      excludedUrlPatterns: z.array(z.string().max(200)).default([]),
      maxResponseMb: z.number().min(0.5).max(32).default(8),
      acceptedContentTypes: z.array(z.string().max(100)).default(["text/html", "application/xhtml+xml"]),
      freshnessDays: z.number().int().min(0).max(365).default(30),
      usePlaywright: z.boolean().default(false),
      stopAfterBlocked: z.number().int().min(1).max(100).default(5),
    })
    .prefault({}),
});

export const discoveryProjectInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  geographicMode: z.enum(GEOGRAPHIC_MODES).default("COUNTRY"),
  maxCompanies: z.number().int().min(1).max(100_000).default(500),
  maxPagesPerCompany: z.number().int().min(1).max(50).default(12),
  maxCrawlDepth: z.number().int().min(0).max(5).default(2),
  minConfidence: z.number().min(0).max(1).default(0.5),
  locations: z.array(discoveryLocationInput).max(200).default([]),
  industries: z
    .array(
      z.object({
        industryId: z.string().min(1),
        mode: filterMode.default("INCLUDE"),
        isPrimary: z.boolean().default(false),
        includeDescendants: z.boolean().default(true),
      }),
    )
    .max(100)
    .default([]),
  keywords: z
    .array(
      z.object({
        keyword: z.string().min(1).max(120),
        keywordType: z.enum(["GENERAL", "PRODUCT", "SERVICE", "TECHNOLOGY", "DOMAIN"]).default("GENERAL"),
        mode: filterMode.default("INCLUDE"),
        language: z.string().min(2).max(8).optional(),
      }),
    )
    .max(200)
    .default([]),
  sources: z
    .array(
      z.object({
        sourceId: z.string().min(1),
        enabled: z.boolean().default(true),
        configuration: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .max(20)
    .default([]),
  settings: discoveryProjectSettings.prefault({}),
});

/** Back-compat alias for the v0 name. */
export const discoveryProjectCreate = discoveryProjectInput;
export const discoveryProjectPatch = discoveryProjectInput.partial();

export type DiscoveryProjectInput = z.infer<typeof discoveryProjectInput>;
export type DiscoveryProjectSettings = z.infer<typeof discoveryProjectSettings>;
export type DiscoveryLocationInput = z.infer<typeof discoveryLocationInput>;

export const companyListQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  q: z.string().max(200).optional(),
  country: z.string().length(2).toUpperCase().optional(),
  regionId: z.string().optional(),
  cityId: z.string().optional(),
  industryId: z.string().optional(),
  projectId: z.string().optional(),
  tag: z.string().max(40).optional(),
  reviewStatus: z.enum(["UNREVIEWED", "NEEDS_REVIEW", "REVIEWED"]).optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  hasContacts: z.enum(["true", "false"]).optional(),
  stale: z.enum(["true", "false"]).optional(),
});

export const contactListQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  q: z.string().max(200).optional(),
  companyId: z.string().optional(),
  projectId: z.string().optional(),
  category: z.enum(CONTACT_CATEGORIES).optional(),
  emailStatus: z.string().max(40).optional(),
  hasPhone: z.enum(["true", "false"]).optional(),
  country: z.string().length(2).toUpperCase().optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
});

export const bulkTag = z.object({
  ids: z.array(z.string().min(1)).min(1).max(1000),
  add: z.array(z.string().min(1).max(40)).max(10).default([]),
  remove: z.array(z.string().min(1).max(40)).max(10).default([]),
});

export const savedSegmentCreate = z.object({
  name: z.string().min(1).max(120),
  entity: z.enum(["COMPANIES", "CONTACTS"]),
  filters: z.record(z.string(), z.unknown()).default({}),
});

export const duplicateDecision = z.object({
  action: z.enum(["MERGE", "DISMISS"]),
  keep: z.enum(["A", "B"]).default("A"),
});

export const contactUpdate = z.object({
  category: z.enum(CONTACT_CATEGORIES).optional(),
  fullName: z.string().max(200).nullable().optional(),
  jobTitle: z.string().max(200).nullable().optional(),
  department: z.string().max(120).nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  reviewed: z.boolean().optional(),
});

export const campaignCreate = z.object({
  name: z.string().min(1).max(200),
  subject: z.string().min(1).max(300),
  bodyHtml: z.string().min(1).max(100000),
  bodyText: z.string().min(1).max(100000),
  segmentDefinition: z
    .object({
      countryCodes: z.array(z.string().length(2)).default([]),
      industries: z.array(z.string()).default([]),
      contactTypes: z.array(z.enum(["PERSON", "GENERIC_BUSINESS"])).default([]),
      minConfidence: z.number().min(0).max(1).default(0),
      onlyMxValid: z.boolean().default(true),
    })
    .default({
      countryCodes: [],
      industries: [],
      contactTypes: [],
      minConfidence: 0,
      onlyMxValid: true,
    }),
  jurisdictionScope: z.array(z.string().length(2)).default([]),
  lawfulBasis: z
    .enum(["CONSENT", "LEGITIMATE_INTEREST", "CONTRACT", "LEGAL_OBLIGATION"])
    .default("LEGITIMATE_INTEREST"),
});

export const campaignSchedule = z.object({
  scheduledAt: z.coerce.date(),
});

export const eligibilityRequest = z.object({
  emailId: z.string().min(1),
  campaignId: z.string().optional(),
  purpose: z.literal("MARKETING").default("MARKETING"),
});

/** A domain-wide suppression is stored with emailNormalized "*@<domain>". */
export const domainSuppressionKey = (domain: string) => `*@${domain.trim().toLowerCase()}`;

export const suppressionCreate = z
  .object({
    email: z.string().email().optional(),
    /** Suppress every address at this domain (e.g. a company that objected). */
    domain: z.string().min(3).max(253).optional(),
    reason: z.enum(["UNSUBSCRIBED", "COMPLAINT", "HARD_BOUNCE", "MANUAL", "LEGAL_OBJECTION"]),
    source: z.string().max(200).optional(),
  })
  .refine((v) => Boolean(v.email || v.domain), { message: "email or domain is required" });

export const verifyRequest = z.object({
  emailId: z.string().optional(),
  email: z.string().email().optional(),
});

export const importRequest = z.object({
  filename: z.string().min(1).max(255),
  idempotencyKey: z.string().min(8).max(200),
  csv: z.string().min(1).max(20_000_000),
});

export const candidateDecision = z.object({
  action: z.enum(["PROMOTE", "REJECT"]),
  reason: z.string().max(500).optional(),
});

export const bounceEvent = z.object({
  email: z.string().email(),
  type: z.enum(["BOUNCE_HARD", "BOUNCE_SOFT", "COMPLAINT"]),
  campaignId: z.string().optional(),
  messageId: z.string().optional(),
  detail: z.string().max(2000).optional(),
});

export type CompanyCreate = z.infer<typeof companyCreate>;
export type CampaignCreate = z.infer<typeof campaignCreate>;
export type ImportRequest = z.infer<typeof importRequest>;
