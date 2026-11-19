import { prisma } from "@leadforge/database";
import { bulkTag, parseBody } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Bulk tagging (spec 21). Tags such as "customer" or "competitor" drive project exclusions. */
export const POST = withAuth(async (request, session) => {
  const input = await parseBody(request, bulkTag);
  const companies = await prisma.company.findMany({
    where: { id: { in: input.ids }, organizationId: session.organization.id },
    select: { id: true, tags: true },
  });
  for (const company of companies) {
    const tags = new Set(company.tags);
    input.add.forEach((t) => tags.add(t.toLowerCase()));
    input.remove.forEach((t) => tags.delete(t.toLowerCase()));
    await prisma.company.update({ where: { id: company.id }, data: { tags: [...tags].sort() } });
  }
  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "company.tag",
    entity: "Company",
    metadata: { count: companies.length, add: input.add, remove: input.remove },
  });
  return json({ data: { updated: companies.length } });
}, "ANALYST");
