/**
 * Email normalization and classification shared by the API and the workers.
 * Deterministic only — no network access, no inference.
 */

const ROLE_PREFIXES = new Set([
  "admin",
  "billing",
  "careers",
  "contact",
  "customerservice",
  "hello",
  "help",
  "hi",
  "hr",
  "info",
  "inquiries",
  "jobs",
  "legal",
  "mail",
  "marketing",
  "media",
  "noreply",
  "no-reply",
  "office",
  "press",
  "privacy",
  "recruiting",
  "sales",
  "security",
  "support",
  "team",
  "webmaster",
]);

const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com",
  "guerrillamail.com",
  "mailinator.com",
  "tempmail.com",
  "throwawaymail.com",
  "yopmail.com",
  "trashmail.com",
  "sharklasers.com",
  "getnada.com",
  "dispostable.com",
]);

const FREE_PROVIDERS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "gmx.com",
  "gmx.de",
  "web.de",
  "mail.com",
  "yandex.com",
  "zoho.com",
]);

// Intentionally simple, strict: one @, no whitespace, dot-separated labels.
const EMAIL_RE =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export interface NormalizedEmail {
  address: string;
  normalized: string;
  localPart: string;
  domain: string;
  valid: boolean;
}

export function normalizeEmail(raw: string): NormalizedEmail {
  const trimmed = raw.trim().replace(/^mailto:/i, "").split("?")[0] ?? "";
  // Strip surrounding punctuation commonly captured by text extraction.
  const cleaned = trimmed.replace(/^[<("'\s]+|[>)"',.;:\s]+$/g, "");
  const at = cleaned.lastIndexOf("@");
  const address = at > 0 ? cleaned : "";

  if (at <= 0) {
    return { address: cleaned, normalized: cleaned.toLowerCase(), localPart: "", domain: "", valid: false };
  }

  const localPart = cleaned.slice(0, at);
  const domainRaw = cleaned.slice(at + 1).toLowerCase().replace(/\.$/, "");
  const domain = domainRaw;
  // Preserve local-part case: it is technically significant. Compare on lowercase.
  const normalized = `${localPart.toLowerCase()}@${domain}`;

  return {
    address: `${localPart}@${domain}`,
    normalized,
    localPart,
    domain,
    valid: EMAIL_RE.test(`${localPart}@${domain}`) && domain.length <= 253,
  };
}

export function isRoleAccount(localPart: string): boolean {
  const base = localPart.toLowerCase().split("+")[0] ?? localPart.toLowerCase();
  return ROLE_PREFIXES.has(base);
}

export function isDisposableDomain(domain: string): boolean {
  return DISPOSABLE_DOMAINS.has(domain.toLowerCase());
}

export function isFreeProvider(domain: string): boolean {
  return FREE_PROVIDERS.has(domain.toLowerCase());
}

export function emailDomain(address: string): string {
  const at = address.lastIndexOf("@");
  return at > 0 ? address.slice(at + 1).toLowerCase() : "";
}

export function maskEmail(address: string): string {
  const [local, domain] = address.split("@");
  if (!domain) return "***";
  const first = local?.[0] ?? "*";
  return `${first}***@${domain}`;
}
