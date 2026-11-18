import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { JURISDICTION_PROFILES } from "@leadforge/compliance";
import { ApiError } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Records human legal sign-off for a jurisdiction profile. This is the only
 * path that enables real sending in a country.
 */
export const POST = withAuth<{ code: string }>(async (_request, session, params) => {
  const code = params.code.toUpperCase();
  const profile = JURISDICTION_PROFILES[code as keyof typeof JURISDICTION_PROFILES];
  if (!profile) throw new ApiError(404, "NOT_FOUND", "No profile for that jurisdiction");

  const record = await prisma.jurisdictionProfile.upsert({
    where: { code_version: { code: profile.code, version: profile.version } },
    create: {
      code: profile.code,
      version: profile.version,
      status: "APPROVED",
      rules: profile as unknown as object,
      approvedBy: session.user.id,
      approvedAt: new Date(),
      notes: `Approved by ${session.user.email}`,
    },
    update: {
      status: "APPROVED",
      approvedBy: session.user.id,
      approvedAt: new Date(),
    },
  });

  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "jurisdiction.approve",
    entity: "JurisdictionProfile",
    entityId: record.id,
    metadata: { code: profile.code, version: profile.version },
  });

  return json({ data: record });
}, "ADMIN");
