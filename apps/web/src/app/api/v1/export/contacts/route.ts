import type { NextRequest } from "next/server";
import { contactCsv, contactWhere } from "@leadforge/pipeline";
import { contactListQuery, parseQuery } from "@leadforge/shared";
import { withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";
import { streamCsv } from "@/lib/stream";

export const dynamic = "force-dynamic";

/** Contact export with provenance. Exporting a contact does not make it eligible for marketing. */
export const GET = withAuth(async (request: NextRequest, session) => {
  const query = parseQuery(new URL(request.url), contactListQuery);
  const where = contactWhere(session.organization.id, query);
  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "export.contacts",
    entity: "Contact",
    metadata: { filters: { ...query, cursor: undefined } },
  });
  return streamCsv(contactCsv(where), `leadforge-contacts-${new Date().toISOString().slice(0, 10)}.csv`);
}, "ANALYST");
