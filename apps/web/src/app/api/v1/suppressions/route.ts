import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { ApiError, domainSuppressionKey, normalizeEmail, parseBody, registrableDomain, suppressionCreate } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (request: NextRequest, session) => {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const rows = await prisma.suppressionEntry.findMany({
    where: {
      OR: [{ organizationId: session.organization.id }, { organizationId: null }],
      ...(q ? { emailNormalized: { contains: q.toLowerCase() } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return json({ data: rows });
}, "VIEWER");

export const POST = withAuth(async (request: NextRequest, session) => {
  const input = await parseBody(request, suppressionCreate);
  let key: string;
  let domain: string;
  if (input.email) {
    const normalized = normalizeEmail(input.email);
    if (!normalized.valid) throw new ApiError(400, "VALIDATION_ERROR", "Invalid email address");
    key = normalized.normalized;
    domain = normalized.domain;
  } else {
    const registrable = registrableDomain(input.domain!);
    if (!registrable) throw new ApiError(400, "VALIDATION_ERROR", "Invalid domain");
    key = domainSuppressionKey(registrable);
    domain = registrable;
  }

  const entry = await prisma.suppressionEntry.upsert({
    where: {
      organizationId_emailNormalized_reason: {
        organizationId: session.organization.id,
        emailNormalized: key,
        reason: input.reason,
      },
    },
    create: {
      organizationId: session.organization.id,
      emailNormalized: key,
      domain,
      reason: input.reason,
      source: input.source ?? `manual:${session.user.email}`,
    },
    update: { liftedAt: null },
  });

  await prisma.emailAddress.updateMany({
    where: input.email ? { normalized: key } : { domain },
    data: { status: "SUPPRESSED" },
  });

  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "suppression.create",
    entity: "SuppressionEntry",
    entityId: entry.id,
    metadata: { reason: input.reason, scope: input.email ? "address" : "domain" },
  });

  return json({ data: entry }, 201);
}, "ANALYST");
