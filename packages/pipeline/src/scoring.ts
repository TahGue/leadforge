/**
 * Explainable confidence (spec section 14). A score is a weighted sum of named
 * components, each with a reason. It is a ranking aid, not objective truth.
 */

export interface ScoreComponent {
  name: string;
  value: number;
  weight: number;
  reason: string;
}

export interface Score {
  score: number;
  components: ScoreComponent[];
}

export function combine(components: ScoreComponent[]): Score {
  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0) || 1;
  const score = components.reduce((sum, c) => sum + c.value * c.weight, 0) / totalWeight;
  return { score: Math.round(Math.min(1, Math.max(0, score)) * 1000) / 1000, components };
}

export const METHOD_RELIABILITY: Record<string, number> = {
  manual: 0.95,
  registry: 0.9,
  mailto: 0.92,
  jsonld: 0.85,
  "contact-link": 0.75,
  text: 0.6,
  tel: 0.88,
  "phone-text": 0.6,
  import: 0.7,
  ai: 0.5,
};

export function companyScore(input: {
  hasOfficialWebsite: boolean;
  independentSources: number;
  sourceType: string | null;
  locationConfidence: number;
  industryConfidence: number;
  observedAt: Date;
  reviewed: boolean;
  freshnessDays?: number;
}): Score {
  const ageDays = (Date.now() - input.observedAt.getTime()) / 86_400_000;
  const freshnessDays = input.freshnessDays ?? 180;
  const sourceReliability =
    input.sourceType === "REGISTRY" ? 0.9 : input.sourceType === "IMPORT" ? 0.7 : input.sourceType ? 0.6 : 0.5;
  return combine([
    {
      name: "official_website",
      value: input.hasOfficialWebsite ? 1 : 0,
      weight: 2,
      reason: input.hasOfficialWebsite ? "Company has a website domain" : "No website domain known",
    },
    {
      name: "corroboration",
      value: Math.min(1, input.independentSources / 2),
      weight: 2,
      reason: `${input.independentSources} independent source(s)`,
    },
    {
      name: "source_reliability",
      value: sourceReliability,
      weight: 2,
      reason: `Source type ${input.sourceType ?? "unknown"}`,
    },
    {
      name: "location",
      value: input.locationConfidence,
      weight: 1,
      reason: `Location resolution confidence ${input.locationConfidence.toFixed(2)}`,
    },
    {
      name: "industry",
      value: input.industryConfidence,
      weight: 1,
      reason: `Industry classification confidence ${input.industryConfidence.toFixed(2)}`,
    },
    {
      name: "freshness",
      value: Math.max(0, 1 - ageDays / freshnessDays),
      weight: 1,
      reason: `Observed ${Math.round(ageDays)} day(s) ago`,
    },
    {
      name: "human_review",
      value: input.reviewed ? 1 : 0.5,
      weight: 1,
      reason: input.reviewed ? "Reviewed by a person" : "Not yet reviewed",
    },
  ]);
}

export function contactScore(input: {
  method: string;
  onCompanyDomain: boolean;
  pagesSeen: number;
  observedAt: Date;
  mxValid: boolean | null;
  reviewed: boolean;
}): Score {
  const ageDays = (Date.now() - input.observedAt.getTime()) / 86_400_000;
  return combine([
    {
      name: "extraction_method",
      value: METHOD_RELIABILITY[input.method] ?? 0.5,
      weight: 3,
      reason: `Extracted via ${input.method}`,
    },
    {
      name: "official_domain",
      value: input.onCompanyDomain ? 1 : 0.3,
      weight: 2,
      reason: input.onCompanyDomain ? "Address is on the company domain" : "Address is on another domain",
    },
    {
      name: "corroboration",
      value: Math.min(1, input.pagesSeen / 2),
      weight: 1,
      reason: `Seen on ${input.pagesSeen} page(s)`,
    },
    {
      name: "freshness",
      value: Math.max(0, 1 - ageDays / 180),
      weight: 1,
      reason: `Observed ${Math.round(ageDays)} day(s) ago`,
    },
    {
      name: "mx",
      value: input.mxValid === null ? 0.5 : input.mxValid ? 1 : 0,
      weight: 1,
      reason: input.mxValid === null ? "Not verified" : input.mxValid ? "Domain accepts mail (MX)" : "No MX",
    },
    {
      name: "human_review",
      value: input.reviewed ? 1 : 0.5,
      weight: 1,
      reason: input.reviewed ? "Reviewed by a person" : "Not yet reviewed",
    },
  ]);
}
