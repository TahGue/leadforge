import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { csvCell } from "@leadforge/shared";
import { audit } from "@/lib/audit";
import { withAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (_request: NextRequest, session) => {
  const companies = await prisma.company.findMany({
    where: { organizationId: session.organization.id, deletedAt: null },
    include: {
      domains: { include: { domain: true } },
      contacts: { include: { emails: { include: { email: true } } } },
    },
    take: 10000,
  });

  const header = [
    "company",
    "domain",
    "country",
    "industry",
    "contact_type",
    "first_name",
    "last_name",
    "job_title",
    "email",
    "email_status",
  ];

  const lines = [header.join(",")];
  for (const company of companies) {
    const domain = company.domains[0]?.domain.domain ?? "";
    if (company.contacts.length === 0) {
      lines.push(
        [company.name, domain, company.countryCode ?? "", company.industry ?? "", "", "", "", "", "", ""]
          .map(csvCell)
          .join(","),
      );
      continue;
    }
    for (const contact of company.contacts) {
      for (const link of contact.emails) {
        lines.push(
          [
            company.name,
            domain,
            company.countryCode ?? "",
            company.industry ?? "",
            contact.type,
            contact.firstName ?? "",
            contact.lastName ?? "",
            contact.jobTitle ?? "",
            link.email.normalized,
            link.email.status,
          ]
            .map(csvCell)
            .join(","),
        );
      }
    }
  }

  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "export.companies",
    entity: "Company",
    metadata: { rows: lines.length - 1 },
  });

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="leadforge-companies-${Date.now()}.csv"`,
      "cache-control": "no-store",
    },
  });
}, "ANALYST");
