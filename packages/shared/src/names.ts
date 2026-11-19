import { getDomain, getPublicSuffix } from "tldts";

/**
 * Normalize a place, industry or company name for matching.
 * Must stay in sync with normalizeName() in packages/database/prisma/reference.mjs
 * and normalize_name() in services/leadforge/normalize.py.
 */
export function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ø/gi, "o")
    .replace(/æ/gi, "ae")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Legal-form suffixes removed before comparing company names. */
const LEGAL_SUFFIXES = [
  "ab", "publ", "aktiebolag", "hb", "kb", "ek for", "ekonomisk forening",
  "as", "asa", "a s", "aps", "a/s", "i s",
  "oy", "oyj", "ky", "tmi",
  "gmbh", "gmbh co kg", "co kg", "kg", "ag", "ug", "e v", "ohg", "mbh",
  "ltd", "limited", "plc", "llp", "llc", "inc", "incorporated", "corp", "corporation", "co",
  "sa", "sarl", "sas", "srl", "spa", "bv", "nv", "oy ab",
];
const SUFFIX_PATTERN = new RegExp(
  `(?:\\s(?:${LEGAL_SUFFIXES.map((s) => s.replace(/[/\\s]/g, "\\s?")).join("|")}))+$`,
);

/** "Nordvind AB (publ)" -> "nordvind". Never use alone to merge companies (spec section 14). */
export function normalizeCompanyName(value: string): string {
  const base = normalizeName(value);
  const stripped = base.replace(SUFFIX_PATTERN, "").trim();
  return stripped || base;
}

/** Hostname from a URL or bare domain, lower-cased, without "www.". Null if not a public domain. */
export function hostFromUrl(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  if (!host.includes(".") || !getPublicSuffix(host, { allowPrivateDomains: true })) return null;
  return host;
}

/** Registrable domain (eTLD+1): "shop.example.co.uk" -> "example.co.uk". */
export function registrableDomain(input: string): string | null {
  const host = hostFromUrl(input);
  if (!host) return null;
  return getDomain(host, { allowPrivateDomains: true }) ?? null;
}

export function topLevelDomain(domain: string): string {
  return getPublicSuffix(domain, { allowPrivateDomains: true }) ?? domain.split(".").slice(-1)[0] ?? "";
}

/** Normalize a business registration number for comparison: keep letters and digits only. */
export function normalizeRegistrationNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.length >= 4 ? cleaned : null;
}

/** Great-circle distance in kilometres. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
