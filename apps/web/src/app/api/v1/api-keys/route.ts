import { createHash, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (_request: NextRequest, session) => {
  const keys = await prisma.apiKey.findMany({
    where: { organizationId: session.organization.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      lastUsedAt: true,
      createdAt: true,
      revokedAt: true,
    },
  });
  return json({ data: keys });
}, "ADMIN");

export const POST = withAuth(async (request: NextRequest, session) => {
  const body = (await request.json().catch(() => ({}))) as { name?: string };
  const name = (body.name ?? "Integration key").slice(0, 100);

  const secret = `lf_${randomBytes(32).toString("base64url")}`;
  const prefix = secret.slice(0, 12);

  const key = await prisma.apiKey.create({
    data: {
      organizationId: session.organization.id,
      name,
      prefix,
      keyHash: createHash("sha256").update(secret).digest("hex"),
      scopes: ["read", "write"],
    },
  });

  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "api_key.create",
    entity: "ApiKey",
    entityId: key.id,
    metadata: { prefix },
  });

  // The secret is returned exactly once and never stored in plaintext.
  return json({ data: { id: key.id, name: key.name, prefix, key: secret } }, 201);
}, "ADMIN");
