import type { NextRequest } from "next/server";
import { prisma, type Prisma } from "@leadforge/database";
import {
  ApiError,
  contactCreate,
  cursorQuery,
  decodeCursor,
  normalizeEmail,
  paginationResult,
  parseBody,
  parseQuery,
} from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";
import { isDisposableDomain, isFreeProvider, isRoleAccount } from "@leadforge/shared";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (request: NextRequest, session) => {
  const url = new URL(request.url);
  const { cursor, limit } = parseQuery(url, cursorQuery);
  const companyId = url.searchParams.get("companyId") ?? undefined;

  const where: Prisma.ContactWhereInput = {
    organizationId: session.organization.id,
    deletedAt: null,
    ...(companyId ? { companyId } : {}),
  };

  if (cursor) {
    const c = decodeCursor<{ t: string; id: string }>(cursor);
    where.AND = [
      {
        OR: [
          { updatedAt: { lt: new Date(c.t) } },
          { updatedAt: new Date(c.t), id: { lt: c.id } },
        ],
      },
    ];
  }

  const rows = await prisma.contact.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    include: {
      company: { select: { id: true, name: true } },
      emails: { include: { email: true } },
    },
  });

  return json(
    paginationResult(rows, limit, (row) => ({ t: row.updatedAt.toISOString(), id: row.id })),
  );
}, "VIEWER");

export const POST = withAuth(async (request: NextRequest, session) => {
  const input = await parseBody(request, contactCreate);

  const company = await prisma.company.findFirst({
    where: { id: input.companyId, organizationId: session.organization.id },
  });
  if (!company) throw new ApiError(404, "NOT_FOUND", "Company not found");

  const result = await prisma.$transaction(async (tx) => {
    const contact = await tx.contact.create({
      data: {
        organizationId: session.organization.id,
        companyId: company.id,
        type: input.type,
        firstName: input.firstName,
        lastName: input.lastName,
        jobTitle: input.jobTitle,
        department: input.department,
        confidence: input.email ? 0.7 : 0.5,
      },
    });

    if (input.email) {
      const normalized = normalizeEmail(input.email);
      if (!normalized.valid) throw new ApiError(400, "VALIDATION_ERROR", "Invalid email address");

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
          pageUrl: company.website ?? "manual",
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
