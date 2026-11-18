import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { argon2id, argon2Verify } from "hash-wasm";
import { prisma, type Organization, type Role, type User } from "@leadforge/database";
import { ApiError } from "@leadforge/shared";

export const SESSION_COOKIE = "lf_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionContext {
  user: Pick<User, "id" | "email" | "name">;
  organization: Pick<Organization, "id" | "name" | "slug">;
  role: Role;
  sessionId: string;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return argon2id({
    password,
    salt,
    parallelism: 1,
    iterations: 3,
    memorySize: 65536,
    hashLength: 32,
    outputType: "encoded",
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash });
  } catch {
    return false;
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, meta: { ip?: string; userAgent?: string }) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 400),
    },
  });
  return { token, session, expiresAt };
}

export async function resolveSession(token: string): Promise<SessionContext | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          memberships: {
            include: { organization: true },
            orderBy: { createdAt: "asc" },
            take: 1,
          },
        },
      },
    },
  });

  if (!session || session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;

  const membership = session.user.memberships[0];
  if (!membership) return null;

  return {
    user: { id: session.user.id, email: session.user.email, name: session.user.name },
    organization: {
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
    },
    role: membership.role,
    sessionId: session.id,
  };
}

export function sessionTokenFromRequest(request: Request): string | null {
  const header = request.headers.get("cookie") ?? "";
  const match = header.match(/(?:^|;\\s*)lf_session=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** Server components use this; API routes resolve from the request instead. */
export async function getSession(): Promise<SessionContext | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return resolveSession(token);
}

export async function requireSession(request?: Request): Promise<SessionContext> {
  const token = request ? sessionTokenFromRequest(request) : (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await resolveSession(token) : null;
  if (!session) throw new ApiError(401, "UNAUTHENTICATED", "Sign in required");
  return session;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
}

const ROLE_RANK: Record<Role, number> = { VIEWER: 1, ANALYST: 2, ADMIN: 3, OWNER: 4 };

export function requireRole(session: SessionContext, minimum: Role): void {
  if (ROLE_RANK[session.role] < ROLE_RANK[minimum]) {
    throw new ApiError(403, "FORBIDDEN", `Requires ${minimum} role`);
  }
}

/** Constant-time API key check with prefix lookup. */
export async function resolveApiKey(rawKey: string) {
  const prefix = rawKey.slice(0, 12);
  const key = await prisma.apiKey.findUnique({
    where: { prefix },
    include: { organization: true },
  });
  if (!key || key.revokedAt) return null;
  const provided = Buffer.from(hashToken(rawKey), "hex");
  const expected = Buffer.from(key.keyHash, "hex");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  return key;
}
