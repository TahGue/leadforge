/**
 * Email and domain verification (spec section 13).
 *
 * Stages: normalize -> syntax -> domain DNS -> MX (with RFC 5321 implicit-MX
 * fallback to A/AAAA) -> provider category -> suppression. Each stage keeps its
 * own status. It never probes a mailbox: MX only proves the domain accepts mail.
 */
import { promises as dnsPromises } from "node:dns";
import { prisma, type EmailStatus, type DnsStatus, type MxStatus, type ProviderCategory } from "@leadforge/database";
import { domainSuppressionKey, isDisposableDomain, isFreeProvider, isRoleAccount, normalizeEmail } from "@leadforge/shared";
import { limits } from "./config";

const DNS_TIMEOUT_MS = 5000;

export interface Resolver {
  resolveMx(domain: string): Promise<{ exchange: string; priority: number }[]>;
  resolve4(domain: string): Promise<string[]>;
  resolve6(domain: string): Promise<string[]>;
}

const systemResolver: Resolver = {
  resolveMx: (d) => dnsPromises.resolveMx(d),
  resolve4: (d) => dnsPromises.resolve4(d),
  resolve6: (d) => dnsPromises.resolve6(d),
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("dns_timeout"), { code: "ETIMEOUT" })), ms);
    }),
  ]);
}

function code(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? (error as Error).message;
}

export interface VerificationOutcome {
  emailId: string;
  normalized: string;
  status: EmailStatus;
  syntaxStatus: "VALID" | "INVALID";
  dnsStatus: DnsStatus;
  mxStatus: MxStatus;
  providerCategory: ProviderCategory;
  suppressed: boolean;
  details: Record<string, unknown>;
}

/** Pure DNS stage, exported for tests with a fake resolver. */
export async function checkDomain(
  domain: string,
  resolver: Resolver = systemResolver,
): Promise<{ dnsStatus: DnsStatus; mxStatus: MxStatus; details: Record<string, unknown> }> {
  const details: Record<string, unknown> = {};
  let mx: { exchange: string; priority: number }[] = [];
  let mxError: string | null = null;
  try {
    mx = await withTimeout(resolver.resolveMx(domain), DNS_TIMEOUT_MS);
  } catch (error) {
    mxError = code(error);
  }

  // RFC 7505 null MX ("." at priority 0) means the domain explicitly accepts no mail.
  const nullMx = mx.length === 1 && (mx[0]!.exchange === "" || mx[0]!.exchange === ".");
  if (mx.length > 0 && !nullMx) {
    const primary = [...mx].sort((a, b) => a.priority - b.priority)[0]!;
    details.mx = mx.length;
    details.primaryMx = primary.exchange;
    return { dnsStatus: "VALID", mxStatus: "VALID", details };
  }
  if (nullMx) {
    details.nullMx = true;
    return { dnsStatus: "VALID", mxStatus: "MISSING", details };
  }

  if (mxError === "ENOTFOUND" || mxError === "ENXDOMAIN") {
    details.error = mxError;
    return { dnsStatus: "NXDOMAIN", mxStatus: "MISSING", details };
  }

  // No MX records (ENODATA) or a transient error: try the implicit MX (A/AAAA).
  let addresses: string[] = [];
  let addressError: string | null = null;
  for (const lookup of [resolver.resolve4, resolver.resolve6]) {
    try {
      addresses = await withTimeout(lookup.call(resolver, domain), DNS_TIMEOUT_MS);
      if (addresses.length) break;
    } catch (error) {
      addressError = code(error);
    }
  }
  if (addresses.length) {
    details.implicitMx = addresses.length;
    return { dnsStatus: "VALID", mxStatus: mxError && mxError !== "ENODATA" ? "ERROR" : "FALLBACK_A", details };
  }
  if (addressError === "ENOTFOUND" || mxError === "ENODATA") {
    details.error = mxError ?? addressError;
    return { dnsStatus: addressError === "ENOTFOUND" ? "NXDOMAIN" : "VALID", mxStatus: "MISSING", details };
  }
  details.error = mxError ?? addressError;
  return { dnsStatus: "ERROR", mxStatus: "ERROR", details };
}

export function providerCategory(localPart: string, domain: string): ProviderCategory {
  if (isDisposableDomain(domain)) return "DISPOSABLE";
  if (isFreeProvider(domain)) return "FREE_MAIL";
  if (isRoleAccount(localPart)) return "ROLE_BASED";
  return "BUSINESS";
}

export function summarize(input: {
  syntaxValid: boolean;
  dnsStatus: DnsStatus;
  mxStatus: MxStatus;
  category: ProviderCategory;
  suppressed: boolean;
}): EmailStatus {
  if (input.suppressed) return "SUPPRESSED";
  if (!input.syntaxValid) return "UNDELIVERABLE";
  if (input.dnsStatus === "NXDOMAIN" || input.mxStatus === "MISSING") return "UNDELIVERABLE";
  if (input.category === "DISPOSABLE") return "RISKY";
  if (input.mxStatus === "VALID") return "MX_VALID";
  if (input.mxStatus === "FALLBACK_A") return "DNS_VALID";
  if (input.dnsStatus === "ERROR" || input.mxStatus === "ERROR") return "DELIVERABILITY_UNKNOWN";
  return "SYNTAX_VALID";
}

export async function isSuppressed(normalized: string, domain: string, organizationId?: string | null) {
  const hit = await prisma.suppressionEntry.findFirst({
    where: {
      liftedAt: null,
      emailNormalized: { in: [normalized, domainSuppressionKey(domain)] },
      ...(organizationId ? { AND: [{ OR: [{ organizationId }, { organizationId: null }] }] } : {}),
    },
    select: { id: true },
  });
  return Boolean(hit);
}

export async function verifyEmail(emailId: string, resolver: Resolver = systemResolver): Promise<VerificationOutcome> {
  const email = await prisma.emailAddress.findUniqueOrThrow({ where: { id: emailId } });
  const normalized = normalizeEmail(email.address);
  const category = providerCategory(normalized.localPart, normalized.domain);
  const suppressed = await isSuppressed(normalized.normalized, normalized.domain);

  let dnsStatus: DnsStatus = "UNKNOWN";
  let mxStatus: MxStatus = "UNKNOWN";
  let details: Record<string, unknown> = {};
  if (normalized.valid) {
    ({ dnsStatus, mxStatus, details } = await checkDomain(normalized.domain, resolver));
  }

  const status = summarize({ syntaxValid: normalized.valid, dnsStatus, mxStatus, category, suppressed });
  const checkedAt = new Date();
  const expiresAt = new Date(checkedAt.getTime() + limits.verificationTtlDays * 86_400_000);

  await prisma.$transaction([
    prisma.emailVerification.create({
      data: {
        emailId,
        method: "PIPELINE",
        result: status,
        syntaxStatus: normalized.valid ? "VALID" : "INVALID",
        dnsStatus,
        mxStatus,
        providerCategory: category,
        details: { ...details, suppressed } as object,
        checkedAt,
        expiresAt,
        resolver: "node:dns",
      },
    }),
    prisma.emailAddress.update({
      where: { id: emailId },
      data: {
        status,
        lastVerifiedAt: checkedAt,
        verificationExpiresAt: expiresAt,
        isRoleAccount: isRoleAccount(normalized.localPart),
        isDisposable: isDisposableDomain(normalized.domain),
        isFreeProvider: isFreeProvider(normalized.domain),
      },
    }),
  ]);

  return {
    emailId,
    normalized: normalized.normalized,
    status,
    syntaxStatus: normalized.valid ? "VALID" : "INVALID",
    dnsStatus,
    mxStatus,
    providerCategory: category,
    suppressed,
    details,
  };
}

/** Emails never verified, or whose verification has expired (spec 13 step 9). */
export async function emailsDueForVerification(limit = 100): Promise<string[]> {
  const rows = await prisma.emailAddress.findMany({
    where: {
      status: { not: "SUPPRESSED" },
      OR: [{ lastVerifiedAt: null }, { verificationExpiresAt: { lt: new Date() } }],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  return rows.map((r) => r.id);
}
