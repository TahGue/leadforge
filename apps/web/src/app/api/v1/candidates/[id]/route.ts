import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { ApiError, candidateDecision, normalizeEmail, parseBody } from "@leadforge/shared";
import { isDisposableDomain, isFreeProvider, isRoleAccount } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit, emit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const POST = withAuth<{ id: string }>(async (request, session, params) => {
  const input = await parseBody(request, candidateDecision);

  const candidate = await prisma.extractionCandidate.findFirst({
    where: { id: params.id, organizationId: session.organization.id },
    include: { artifact: true, company: true },
  });
  if (!candidate) throw new ApiError(404, "NOT_FOUND", "Candidate not found");
  if (candidate.status !== "PENDING") {
    throw new ApiError(409, "CONFLICT", "Candidate has already been reviewed");
  }

  if (input.action === "REJECT") {
    const rejected = await prisma.extractionCandidate.update({
      where: { id: candidate.id },
      data: {
        status: "REJECTED",
        reviewedBy: session.user.id,
        reviewedAt: new Date(),
        rejectReason: input.reason ?? "manual rejection",
      },
    });
    await audit({
      organizationId: session.organization.id,
      actorId: session.user.id,
      action: "candidate.reject",
      entity: "ExtractionCandidate",
      entityId: candidate.id,
      metadata: { reason: input.reason ?? null },
    });
    return json({ data: rejected });
  }

  if (!candidate.companyId || !candidate.company) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Candidate is not linked to a company; create the company first",
    );
  }

  const normalized = normalizeEmail(candidate.rawValue);
  if (!normalized.valid) {
    throw new ApiError(400, "VALIDATION_ERROR", "Candidate is not a valid email address");
  }

  const promoted = await prisma.$transaction(async (tx) => {
    const email = await tx.emailAddress.upsert({
      where: { normalized: normalized.normalized },
      create: {
        address: normalized.address,
        normalized: normalized.normalized,
        localPart: normalized.localPart,
        domain: normalized.domain,
        isRoleAccount: isRoleAccount(normalized.localPart),
        isDisposable: isDisposableDomain(normalized.domain),
        isFreeProvider: isFreeProvider(normalized.domain),
      },
      update: {},
    });

    const roleAccount = isRoleAccount(normalized.localPart);
    let contact = await tx.contact.findFirst({
      where: {
        organizationId: session.organization.id,
        companyId: candidate.companyId!,
        type: roleAccount ? "GENERIC_BUSINESS" : "PERSON",
      },
    });

    if (!contact) {
      contact = await tx.contact.create({
        data: {
          organizationId: session.organization.id,
          companyId: candidate.companyId!,
          type: roleAccount ? "GENERIC_BUSINESS" : "PERSON",
          confidence: candidate.confidence,
        },
      });
    }

    await tx.contactEmail.upsert({
      where: { contactId_emailId: { contactId: contact.id, emailId: email.id } },
      create: { contactId: contact.id, emailId: email.id, isPrimary: true, confidence: candidate.confidence },
      update: {},
    });

    await tx.sourceEvidence.create({
      data: {
        organizationId: session.organization.id,
        companyId: candidate.companyId!,
        contactId: contact.id,
        emailId: email.id,
        fetchArtifactId: candidate.fetchArtifactId,
        pageUrl: candidate.artifact.url,
        fieldName: "email",
        extractedValue: normalized.address,
        extractorVersion: candidate.method,
        method: candidate.method,
        snippet: candidate.snippet,
        contentHash: candidate.artifact.bodySha256,
      },
    });

    const updated = await tx.extractionCandidate.update({
      where: { id: candidate.id },
      data: {
        status: "PROMOTED",
        reviewedBy: session.user.id,
        reviewedAt: new Date(),
        normalizedValue: normalized.normalized,
        promotedEmailId: email.id,
        promotedContactId: contact.id,
      },
    });

    await emit(tx, {
      organizationId: session.organization.id,
      type: "contact.promoted",
      aggregateType: "Contact",
      aggregateId: contact.id,
      payload: { emailId: email.id, candidateId: candidate.id },
    });

    return { candidate: updated, emailId: email.id, contactId: contact.id };
  });

  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "candidate.promote",
    entity: "ExtractionCandidate",
    entityId: candidate.id,
    metadata: { emailId: promoted.emailId, contactId: promoted.contactId },
  });

  return json({ data: promoted });
}, "ANALYST");
