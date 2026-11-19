/**
 * CSV exports with provenance (spec sections 21 and 28). Every contact row
 * carries the page it was found on and when; every company row carries its
 * evidence count and last observation. Exports never imply campaign eligibility.
 */
import { prisma, type Prisma } from "@leadforge/database";
import { csvCell } from "@leadforge/shared";

const BATCH = 500;

function line(values: unknown[]): string {
  return `${values.map(csvCell).join(",")}\n`;
}

export async function* companyCsv(where: Prisma.CompanyWhereInput, max = 100_000): AsyncGenerator<string> {
  yield line([
    "company_id", "name", "domain", "country", "region", "city", "industries", "employee_range",
    "website_status", "contact_count", "evidence_count", "confidence", "review_status", "tags",
    "first_seen_at", "last_observed_at", "sources",
  ]);
  let cursor: string | undefined;
  let emitted = 0;
  while (emitted < max) {
    const rows = await prisma.company.findMany({
      where,
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: {
        domains: { include: { domain: { select: { domain: true } } }, where: { isPrimary: true }, take: 1 },
        locations: {
          include: { region: { select: { name: true } }, city: { select: { name: true } } },
          orderBy: { isHeadquarters: "desc" },
          take: 1,
        },
        industries: { include: { industry: { select: { name: true } } }, orderBy: { isPrimary: "desc" } },
        observations: { distinct: ["sourceId"], select: { source: { select: { name: true } } } },
        _count: { select: { contacts: true, evidence: true } },
      },
    });
    if (!rows.length) break;
    for (const c of rows) {
      const loc = c.locations[0];
      yield line([
        c.id,
        c.name,
        c.domains[0]?.domain.domain ?? "",
        c.countryCode ?? "",
        loc?.region?.name ?? "",
        loc?.city?.name ?? loc?.rawText ?? "",
        c.industries.map((i) => i.industry.name).join("; "),
        c.employeeRange ?? "",
        c.websiteStatus,
        c._count.contacts,
        c._count.evidence,
        c.confidence,
        c.reviewStatus,
        c.tags.join("; "),
        c.firstSeenAt.toISOString(),
        c.lastSeenAt.toISOString(),
        c.observations.map((o) => o.source.name).join("; "),
      ]);
      emitted += 1;
    }
    cursor = rows[rows.length - 1]!.id;
    if (rows.length < BATCH) break;
  }
}

export async function* contactCsv(where: Prisma.ContactWhereInput, max = 100_000): AsyncGenerator<string> {
  yield line([
    "contact_id", "company", "company_domain", "country", "category", "type", "full_name", "job_title",
    "email", "email_status", "syntax", "mx", "provider", "phone", "contact_form_url", "confidence",
    "suppressed", "source_url", "extraction_method", "observed_at",
  ]);
  let cursor: string | undefined;
  let emitted = 0;
  while (emitted < max) {
    const rows = await prisma.contact.findMany({
      where,
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: {
        company: {
          select: {
            name: true,
            countryCode: true,
            domains: { where: { isPrimary: true }, take: 1, include: { domain: { select: { domain: true } } } },
          },
        },
        emails: {
          include: {
            email: {
              include: { verifications: { orderBy: { checkedAt: "desc" }, take: 1 } },
            },
          },
          orderBy: { isPrimary: "desc" },
          take: 1,
        },
        evidence: { orderBy: { observedAt: "desc" }, take: 1 },
      },
    });
    if (!rows.length) break;
    const emails = rows.flatMap((r) => r.emails.map((e) => e.email.normalized));
    const suppressed = new Set(
      (
        await prisma.suppressionEntry.findMany({
          where: { emailNormalized: { in: emails }, liftedAt: null },
          select: { emailNormalized: true },
        })
      ).map((s) => s.emailNormalized),
    );
    for (const c of rows) {
      const email = c.emails[0]?.email;
      const check = email?.verifications[0];
      const evidence = c.evidence[0];
      yield line([
        c.id,
        c.company.name,
        c.company.domains[0]?.domain.domain ?? "",
        c.company.countryCode ?? "",
        c.category,
        c.type,
        c.fullName ?? [c.firstName, c.lastName].filter(Boolean).join(" "),
        c.jobTitle ?? "",
        email?.normalized ?? "",
        email?.status ?? "",
        check?.syntaxStatus ?? "",
        check?.mxStatus ?? "",
        check?.providerCategory ?? "",
        c.phoneE164 ?? c.phoneRaw ?? "",
        c.contactFormUrl ?? "",
        c.confidence,
        email ? suppressed.has(email.normalized) : false,
        evidence?.pageUrl ?? c.sourceUrl ?? "",
        evidence?.method ?? "",
        (evidence?.observedAt ?? c.observedAt).toISOString(),
      ]);
      emitted += 1;
    }
    cursor = rows[rows.length - 1]!.id;
    if (rows.length < BATCH) break;
  }
}
