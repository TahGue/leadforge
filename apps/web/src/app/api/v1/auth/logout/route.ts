import type { NextRequest } from "next/server";
import { json, SESSION_COOKIE, withAuth } from "@/lib/api";
import { revokeSession } from "@/lib/auth";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (_request: NextRequest, session) => {
  if (!session.sessionId.startsWith("api-key:")) {
    await revokeSession(session.sessionId);
  }
  const response = json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    path: "/",
    maxAge: 0,
  });
  return response;
});
