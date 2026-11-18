import type { NextRequest } from "next/server";
import { prisma, type Prisma } from "@leadforge/database";
import { contactWhere, isSuppressed } from "@leadforge/pipeline";
import {
  ApiError,
  contactCreate,
  contactListQuery,
  decodeCursor,
  isDisposableDomain,
  isFreeProvider,
  isRoleAccount,
  normalizeEmail,
  paginationResult,
  parseBody,
  parseQuery,
} from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (request: NextRequest, session) => {
  const query = parseQuery(new URL(request.url), contactListQuery);
  const where = contactWhere(session.organization.id, query);
  if (query.cursor) {
    const c = decodeCursor<{ t: string; id: string }>(query.cursor);
    (where.AND as Prisma.ContactWhereInput[]).push({
      OR: [{ updatedAt: { lt: new Date(c.t) } }, { updatedAt: new Date(c.t), id: { lt: c.id } }],
    });
  }
  const rows = await prisma.contact.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    include: {
      company: { select: { id: true, name: true, countryCode: true } },
      emails: { include: { email: { include: { verifications: { orderBy: { checkedAt: "desc" }, take: 1 } } } } },
      evidence: { orderBy: { observedAt: "desc" }, take: 1, select: { pageUrl: true, method: true, observedAt: true } },
    },
  });
  return json(paginationResult(rows, query.limit, (row) => ({ t: row.updatedAt.toISOString(), id: row.id })));
}, "VIEWER");

/**
 * Manual contact entry. Spec 5.9: a source URL is required for every contact, and
 * suppression is checked at contact creation (spec 19).
 */
export const POST = withAuth(async (request: NextRequest, session) => {
  const input = await parseBody(request, contactCreate);
  const company = await prisma.company.findFirst({
    where: { id: input.companyId, organizationId: session.organization.id, deletedAt: null },
  });
  if (!company) throw new ApiError(404, "NOT_FOUND", "Company not found");

  const normalized = input.email ? normalizeEmail(input.email) : null;
  if (normalized && !normalized.valid) throw new ApiError(400, "VALIDATION_ERROR", "Invalid email address");
  if (normalized && (await isSuppressed(normalized.normalized, normalized.domain, session.organization.id))) {
    throw new ApiError(409, "CONFLICT", "This address is on the suppression list and cannot be added");
  }
  const roleBased = normalized ? isRoleAccount(normalized.localPart) : input.type === "GENERIC_BUSINESS";

  const result = await prisma.$transaction(async (tx) => {
    const contact = await tx.contact.create({
      data: {
        organizationId: session.organization.id,
        companyId: company.id,
        type: input.type,
        category: input.category,
        firstName: input.firstName,
        lastName: input.lastName,
        fullName: input.fullName ?? ([input.firstName, input.lastName].filter(Boolean).join(" ") || null),
        jobTitle: input.jobTitle,
        department: input.department,
        isRoleBased: roleBased,
        phoneRaw: input.phone,
        sourceUrl: input.sourceUrl,
        confidence: input.email ? 0.7 : 0.5,
        reviewedAt: new Date(),
      },
    });

    if (normalized) {
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
      await tx.contactEmail.create({
        data: { contactId: contact.id, emailId: email.id, isPrimary: true, confidence: 0.7 },
      });
      await tx.sourceEvidence.create({
        data: {
          organizationId: session.organization.id,
          companyId: company.id,
          contactId: contact.id,
          emailId: email.id,
          pageUrl: input.sourceUrl,
          fieldName: "email",
          extractedValue: normalized.address,
          method: "manual",
        },
      });
      await tx.domainEvent.create({
        data: {
          organizationId: session.organization.id,
          type: "contact.promoted",
          aggregateType: "Contact",
          aggregateId: contact.id,
          payload: { emailId: email.id },
        },
      });
    }
    return contact;
  });

  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "contact.create",
    entity: "Contact",
    entityId: result.id,
  });
  return json({ data: result }, 201);
}, "ANALYST");
