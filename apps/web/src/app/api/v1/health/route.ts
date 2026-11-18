import { NextResponse } from "next/server";
import { prisma } from "@leadforge/database";

export const dynamic = "force-dynamic";

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

  checks.mail = process.env.MAIL_ENABLED === "true" ? "enabled" : "disabled";
  checks.version = process.env.npm_package_version ?? "0.1.0";

  return NextResponse.json(
    { status: ok ? "ok" : "degraded", checks, timestamp: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
