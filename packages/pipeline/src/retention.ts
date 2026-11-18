/**
 * Retention (spec sections 15 and 18). Deletes what has outlived its purpose;
 * never deletes suppression entries (they prevent re-contact) or audit rows
 * younger than the audit retention period. Raw artifact files are purged by the
 * Python worker, which owns the artifact volume.
 */
import { prisma } from "@leadforge/database";
import { retention } from "./config";

export interface RetentionReport {
  rejectedCandidates: number;
  stagingRows: number;
  auditRows: number;
  expiredSessions: number;
  sourceObservations: number;
}

export async function applyRetention(now = new Date()): Promise<RetentionReport> {
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000);

  const rejectedCandidates = await prisma.extractionCandidate.deleteMany({
    where: { status: "REJECTED", createdAt: { lt: days(retention.rejectedCandidatesDays) } },
  });
  const stagingRows = await prisma.companyCandidate.deleteMany({
    where: { status: { not: "PENDING" }, createdAt: { lt: days(retention.stagingDays) } },
  });
  const auditRows = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: days(retention.auditDays) } } });
  const expiredSessions = await prisma.session.deleteMany({ where: { expiresAt: { lt: days(1) } } });

  // Per-source retention restrictions (spec section 10): observations from a source
  // with retentionDays are dropped once they are older than that.
  let sourceObservations = 0;
  const restricted = await prisma.source.findMany({
    where: { retentionDays: { not: null } },
    select: { id: true, retentionDays: true },
  });
  for (const source of restricted) {
    const result = await prisma.sourceObservation.deleteMany({
      where: { sourceId: source.id, observedAt: { lt: days(source.retentionDays!) } },
    });
    sourceObservations += result.count;
  }

  return {
    rejectedCandidates: rejectedCandidates.count,
    stagingRows: stagingRows.count,
    auditRows: auditRows.count,
    expiredSessions: expiredSessions.count,
    sourceObservations,
  };
}

/**
 * Data-subject erasure (spec section 18): removes a person's contact data while
 * keeping a suppression entry so the address is never re-imported or contacted.
 */
export async function eraseEmail(organizationId: string, emailNormalized: string): Promise<{ contacts: number }> {
  const email = await prisma.emailAddress.findUnique({ where: { normalized: emailNormalized } });
  return prisma.$transaction(async (tx) => {
    await tx.suppressionEntry.upsert({
      where: {
        organizationId_emailNormalized_reason: { organizationId, emailNormalized, reason: "LEGAL_OBJECTION" },
      },
      create: {
        organizationId,
        emailNormalized,
        domain: emailNormalized.split("@")[1] ?? null,
        reason: "LEGAL_OBJECTION",
        source: "data_subject_request",
      },
      update: { liftedAt: null },
    });
    if (!email) return { contacts: 0 };
    const links = await tx.contactEmail.findMany({
      where: { emailId: email.id, contact: { organizationId } },
      select: { contactId: true },
    });
    const contactIds = links.map((l) => l.contactId);
    await tx.extractionCandidate.deleteMany({ where: { organizationId, normalizedValue: emailNormalized } });
    await tx.sourceEvidence.deleteMany({ where: { organizationId, emailId: email.id } });
    await tx.contactEmail.deleteMany({ where: { emailId: email.id, contactId: { in: contactIds } } });
    // Named contacts are personal data: delete them. Role contacts keep phone/form data.
    await tx.contact.deleteMany({ where: { id: { in: contactIds }, type: "PERSON" } });
    const remaining = await tx.contactEmail.count({ where: { emailId: email.id } });
    if (remaining === 0) {
      await tx.emailVerification.deleteMany({ where: { emailId: email.id } });
      await tx.emailAddress.update({
        where: { id: email.id },
        data: { status: "SUPPRESSED", address: emailNormalized },
      });
    }
    return { contacts: contactIds.length };
  });
}
