import type { NextRequest } from "next/server";
import { companyCsv, companyWhere } from "@leadforge/pipeline";
import { companyListQuery, parseQuery } from "@leadforge/shared";
import { withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";
import { streamCsv } from "@/lib/stream";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (request: NextRequest, session) => {
  const query = parseQuery(new URL(request.url), companyListQuery);
  const where = await companyWhere(session.organization.id, query);
  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "export.companies",
    entity: "Company",
    metadata: { filters: { ...query, cursor: undefined } },
  });
  return streamCsv(companyCsv(where), `leadforge-companies-${new Date().toISOString().slice(0, 10)}.csv`);
}, "ANALYST");
