import { NextResponse } from "next/server";
import { prisma } from "@leadforge/database";
import { features, pingRedis } from "@leadforge/pipeline";

export const dynamic = "force-dynamic";

/** Liveness/readiness. Postgres is required; Redis is reported but not required (ADR-0021). */
export async function GET() {
  const checks: Record<string, string> = {};
  let ok = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "up";
  } catch {
    checks.database = "down";
    ok = false;
  }
  try {
    const rows = await prisma.$queryRaw<{ v: string }[]>`SELECT postgis_version() AS v`;
    checks.postgis = rows[0]?.v ? "up" : "missing";
  } catch {
    checks.postgis = "missing";
    ok = false;
  }
  checks.redis = await pingRedis();
  checks.campaigns = features.campaigns ? "enabled" : "frozen";
  checks.mail = process.env.MAIL_ENABLED === "true" ? "enabled" : "disabled";
  checks.version = process.env.npm_package_version ?? "0.2.0";
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", checks, timestamp: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
