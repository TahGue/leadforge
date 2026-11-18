import { NextResponse, type NextRequest } from "next/server";
import { ApiError, type ErrorCode } from "@leadforge/shared";
import {
  SESSION_COOKIE,
  requireRole,
  requireSession,
  resolveApiKey,
  type SessionContext,
} from "./auth";
import { env } from "./env";

export type RouteContext<P = Record<string, string>> = { params: Promise<P> };

export function json<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function problem(
  status: number,
  code: ErrorCode,
  message: string,
  details?: unknown,
): NextResponse {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export function handleError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return problem(error.status, error.code, error.message, error.details);
  }
  console.error("api_error", error);
  return problem(500, "INTERNAL", "Internal server error");
}

export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "unknown";
  return request.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Credential-bearing mutations must come from our own origin when a session
 * cookie is used. API keys are exempt because they are not ambient credentials.
 */
function assertSameOrigin(request: NextRequest): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  if (request.headers.get("authorization")) return;
  const origin = request.headers.get("origin");
  if (!origin) return; // non-browser client without ambient cookie abuse surface
  const expected = new URL(env.appUrl).origin;
  if (origin !== expected) {
    throw new ApiError(403, "FORBIDDEN", "Cross-origin request rejected");
  }
}

async function authenticate(request: NextRequest): Promise<SessionContext> {
  const bearer = request.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) {
    const key = await resolveApiKey(bearer.slice(7).trim());
    if (!key) throw new ApiError(401, "UNAUTHENTICATED", "Invalid API key");
    return {
      user: { id: key.id, email: `api-key:${key.prefix}`, name: key.name },
      organization: {
        id: key.organization.id,
        name: key.organization.name,
        slug: key.organization.slug,
      },
      // API keys are organization-scoped integrations.
      role: "ADMIN",
      sessionId: `api-key:${key.id}`,
    };
  }
  return requireSession(request);
}

export type AuthedHandler<P> = (
  request: NextRequest,
  session: SessionContext,
  params: P,
) => Promise<Response>;

export function withAuth<P = Record<string, string>>(
  handler: AuthedHandler<P>,
  minimumRole?: "VIEWER" | "ANALYST" | "ADMIN" | "OWNER",
) {
  return async (request: NextRequest, context: RouteContext<P>): Promise<Response> => {
    try {
      const session = await authenticate(request);
      assertSameOrigin(request);
      if (minimumRole) requireRole(session, minimumRole);
      const params = context?.params ? await context.params : ({} as P);
      return await handler(request, session, params);
    } catch (error) {
      return handleError(error);
    }
  };
}

export function withPublic(handler: (request: NextRequest) => Promise<Response>) {
  return async (request: NextRequest): Promise<Response> => {
    try {
      return await handler(request);
    } catch (error) {
      return handleError(error);
    }
  };
}

export { SESSION_COOKIE };
