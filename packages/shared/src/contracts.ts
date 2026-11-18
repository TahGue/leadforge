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
  city: z.string().max(120).optional(),
  industry: z.string().max(120).optional(),
  employeeRange: z.string().max(40).optional(),
  website: z.string().url().optional(),
});

export const companyUpdate = companyCreate.partial();

export const contactCreate = z.object({
  companyId: z.string().min(1),
  type: z.enum(["PERSON", "GENERIC_BUSINESS"]).default("PERSON"),
  firstName: z.string().max(120).optional(),
  lastName: z.string().max(120).optional(),
  jobTitle: z.string().max(200).optional(),
  department: z.string().max(120).optional(),
  email: z.string().email().optional(),
});

export const sourceCreate = z.object({
  name: z.string().min(1).max(200),
  sourceType: z.enum(["WEBSITE", "DIRECTORY", "SEARCH", "REGISTRY", "IMPORT", "MANUAL"]),
  baseUrl: z.string().url().optional(),
  policyNotes: z.string().max(4000).optional(),
  tosUrl: z.string().url().optional(),
});

export const sourcePolicyUpdate = z.object({
  permitted: z.boolean(),
  policyNotes: z.string().max(4000).optional(),
  tosUrl: z.string().url().optional(),
});

export const discoveryProjectCreate = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  criteria: z
    .object({
      countries: z.array(z.string().length(2)).default([]),
      industries: z.array(z.string()).default([]),
      employeeRange: z.string().optional(),
      keywords: z.array(z.string()).default([]),
    })
    .default({ countries: [], industries: [], keywords: [] }),
  budget: z
    .object({
      maxTargets: z.number().int().min(1).max(100000).default(500),
      maxPagesPerDomain: z.number().int().min(1).max(50).default(5),
      maxDepth: z.number().int().min(0).max(5).default(1),
      delayMs: z.number().int().min(500).max(30000).default(2000),
    })
    .default({ maxTargets: 500, maxPagesPerDomain: 5, maxDepth: 1, delayMs: 2000 }),
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

export const suppressionCreate = z.object({
  email: z.string().email(),
  reason: z.enum(["UNSUBSCRIBED", "COMPLAINT", "HARD_BOUNCE", "MANUAL", "LEGAL_OBJECTION"]),
  source: z.string().max(200).optional(),
  domain: z.string().max(253).optional(),
});

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
