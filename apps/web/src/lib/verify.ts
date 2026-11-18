import { promises as dns } from "node:dns";
import { prisma, type EmailStatus } from "@leadforge/database";
import { isDisposableDomain, isFreeProvider, isRoleAccount, normalizeEmail } from "@leadforge/shared";

const VERIFICATION_TTL_DAYS = 90;
const DNS_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("dns_timeout")), ms)),
  ]);
}

export interface VerifyResult {
  emailId: string;
  status: EmailStatus;
  normalized: string;
  checks: { method: string; result: string; detail?: string }[];
}

/**
 * Verification stops at syntax + DNS + MX. It never probes the mailbox:
 * MX only proves the domain accepts mail, not that a person exists.
 */
export async function verifyEmail(emailId: string): Promise<VerifyResult> {
  const email = await prisma.emailAddress.findUniqueOrThrow({ where: { id: emailId } });
  const normalized = normalizeEmail(email.address);
  const checks: VerifyResult["checks"] = [];

  if (!normalized.valid) {
    checks.push({ method: "SYNTAX", result: "INVALID", detail: "Address failed syntax validation" });
    await persist(emailId, checks, "UNDELIVERABLE", null);
    return { emailId, status: "UNDELIVERABLE", normalized: normalized.normalized, checks };
  }
  checks.push({ method: "SYNTAX", result: "VALID" });

  let status: EmailStatus = "SYNTAX_VALID";
  let expiresAt: Date | null = null;

  try {
    const mx = await withTimeout(dns.resolveMx(normalized.domain), DNS_TIMEOUT_MS);
    if (mx.length > 0) {
      checks.push({
        method: "MX",
        result: "VALID",
        detail: `${mx.length} record(s), primary ${mx.sort((a, b) => a.priority - b.priority)[0]?.exchange}`,
      });
      status = "MX_VALID";
      expiresAt = new Date(Date.now() + VERIFICATION_TTL_DAYS * 86_400_000);
    } else {
      checks.push({ method: "MX", result: "NONE" });
      status = "UNDELIVERABLE";
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA") {
      checks.push({ method: "DNS", result: "NXDOMAIN", detail: "Domain does not resolve" });
      status = "UNDELIVERABLE";
    } else {
      checks.push({
        method: "DNS",
        result: "ERROR",
        detail: code ?? (error as Error).message,
      });
      status = "RISKY";
    }
  }

  await persist(emailId, checks, status, expiresAt, {
    isRoleAccount: isRoleAccount(normalized.localPart),
    isDisposable: isDisposableDomain(normalized.domain),
    isFreeProvider: isFreeProvider(normalized.domain),
  });

  return { emailId, status, normalized: normalized.normalized, checks };
}

async function persist(
  emailId: string,
  checks: VerifyResult["checks"],
  status: EmailStatus,
  expiresAt: Date | null,
  flags?: { isRoleAccount: boolean; isDisposable: boolean; isFreeProvider: boolean },
): Promise<void> {
  await prisma.$transaction([
    ...checks.map((check) =>
      prisma.emailVerification.create({
        data: {
          emailId,
          method: check.method,
          result: check.result,
          details: check.detail ? { detail: check.detail } : {},
          expiresAt,
          resolver: "node:dns",
        },
      }),
    ),
    prisma.emailAddress.update({
      where: { id: emailId },
      data: {
        status,
        lastVerifiedAt: new Date(),
        verificationExpiresAt: expiresAt,
        ...(flags ? { ...flags } : {}),
      },
    }),
  ]);
}
