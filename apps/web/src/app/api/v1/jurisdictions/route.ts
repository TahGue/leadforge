import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { JURISDICTION_PROFILES } from "@leadforge/compliance";
import { json, withCampaignAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withCampaignAuth(async (_request: NextRequest) => {
  const approvals = await prisma.jurisdictionProfile.findMany({
    where: { status: "APPROVED" },
    orderBy: { approvedAt: "desc" },
  });

  const data = Object.values(JURISDICTION_PROFILES).map((profile) => {
    const approved = approvals.find((a) => a.code === profile.code && a.version === profile.version);
    return {
      code: profile.code,
      version: profile.version,
      regime: profile.regime,
      status: approved ? "APPROVED" : profile.status,
      approvedAt: approved?.approvedAt ?? null,
      notes: profile.notes,
    };
  });

  return json({ data });
}, "VIEWER");
