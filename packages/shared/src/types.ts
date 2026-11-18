export type EntityType = "CORPORATE" | "INDIVIDUAL" | "UNKNOWN";

export type JurisdictionCode = "SE" | "DE" | "GB" | "US";

export const JURISDICTION_LABELS: Record<JurisdictionCode, string> = {
  SE: "Sweden",
  DE: "Germany",
  GB: "United Kingdom",
  US: "United States",
};

/** Country codes that map onto a supported jurisdiction profile. */
export const COUNTRY_TO_JURISDICTION: Record<string, JurisdictionCode> = {
  SE: "SE",
  DE: "DE",
  GB: "GB",
  UK: "GB",
  US: "US",
};

export function resolveJurisdiction(countryCode: string | null | undefined): JurisdictionCode | null {
  if (!countryCode) return null;
  return COUNTRY_TO_JURISDICTION[countryCode.toUpperCase()] ?? null;
}

export interface Paginated<T> {
  data: T[];
  nextCursor: string | null;
}
