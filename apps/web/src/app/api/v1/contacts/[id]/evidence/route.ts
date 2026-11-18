import { prisma } from "@leadforge/database";
import { ApiError } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withAuth<{ id: string }>(async (_request, session, params) => {
  const contact = await prisma.contact.findFirst({
    where: { id: params.id, organizationId: session.organization.id },
    select: { id: true },
  });
  if (!contact) throw new ApiError(404, "NOT_FOUND", "Contact not found");
  const [evidence, candidates] = await Promise.all([
    prisma.sourceEvidence.findMany({ where: { contactId: contact.id }, orderBy: { observedAt: "desc" } }),
    prisma.extractionCandidate.findMany({
      where: { promotedContactId: contact.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, method: true, snippet: true, confidence: true, pageUrl: true, createdAt: true, kind: true },
    }),
  ]);
  return json({ data: { evidence, candidates } });
}, "VIEWER");
