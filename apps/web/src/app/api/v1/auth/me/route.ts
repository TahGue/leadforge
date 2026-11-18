import type { NextRequest } from "next/server";
import { json, withAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (_request: NextRequest, session) =>
  json({
    user: session.user,
    organization: session.organization,
    role: session.role,
  }),
);
