import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { ApiError, loginSchema, parseBody } from "@leadforge/shared";
import { clientIp, handleError, json, SESSION_COOKIE } from "@/lib/api";
import { createSession, verifyPassword } from "@/lib/auth";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const ip = clientIp(request);
    rateLimit(`login:${ip}`, 10, 60_000);

    const { email, password } = await parseBody(request, loginSchema);
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { memberships: { take: 1 } },
    });

    // Always run a hash comparison to keep timing uniform for unknown users.
    const hash = user?.passwordHash ?? "$argon2id$v=19$m=65536,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const valid = await verifyPassword(hash, password);

    if (!user || !valid || user.status !== "ACTIVE" || user.memberships.length === 0) {
      await prisma.auditLog.create({
        data: {
          action: "auth.login_failed",
          entity: "User",
          entityId: user?.id ?? null,
          ip,
          metadata: { email: email.toLowerCase() },
        },
      });
      throw new ApiError(401, "UNAUTHENTICATED", "Invalid email or password");
    }

    const { token, expiresAt } = await createSession(user.id, {
      ip,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
      prisma.auditLog.create({
        data: {
          organizationId: user.memberships[0]?.organizationId,
          actorId: user.id,
          action: "auth.login",
          entity: "User",
          entityId: user.id,
          ip,
        },
      }),
    ]);

    const response = json({ user: { id: user.id, email: user.email, name: user.name } });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.cookieSecure,
      path: "/",
      expires: expiresAt,
    });
    return response;
  } catch (error) {
    return handleError(error);
  }
}
