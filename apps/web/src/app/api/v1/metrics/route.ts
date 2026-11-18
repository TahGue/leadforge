import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { renderMetrics } from "@/lib/metrics";

export const dynamic = "force-dynamic";

/**
 * Prometheus scrape endpoint (spec 22). Requires METRICS_TOKEN as a bearer token;
 * returns 404 when no token is configured so it is never public by accident.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.METRICS_TOKEN ?? "";
  if (!expected) return new Response("Not found", { status: 404 });
  const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Unauthorized", { status: 401 });
  const { body, contentType } = await renderMetrics();
  return new Response(body, { status: 200, headers: { "Content-Type": contentType, "Cache-Control": "no-store" } });
}
