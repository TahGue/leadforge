import Link from "next/link";
import { prisma, type Prisma } from "@leadforge/database";
import { contactWhere } from "@leadforge/pipeline";
import { CONTACT_CATEGORIES, contactListQuery, decodeCursor, encodeCursor } from "@leadforge/shared";
import { requireSession } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { ContactsTable, type ContactRow } from "@/components/contacts-table";

export const dynamic = "force-dynamic";

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const raw = await searchParams;
  const parsed = contactListQuery.safeParse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v)));
  const query = parsed.success ? parsed.data : contactListQuery.parse({});
  const where = contactWhere(session.organization.id, query);
  if (query.cursor) {
    const c = decodeCursor<{ t: string; id: string }>(query.cursor);
    (where.AND as Prisma.ContactWhereInput[]).push({ OR: [{ updatedAt: { lt: new Date(c.t) } }, { updatedAt: new Date(c.t), id: { lt: c.id } }] });
  }
  const [rows, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      include: {
        company: { select: { id: true, name: true, countryCode: true } },
        emails: { include: { email: { include: { verifications: { orderBy: { checkedAt: "desc" }, take: 1 } } } }, orderBy: { isPrimary: "desc" }, take: 1 },
        evidence: { orderBy: { observedAt: "desc" }, take: 1 },
      },
    }),
    prisma.contact.count({ where }),
  ]);
  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];
  const next = hasMore && last ? encodeCursor({ t: last.updatedAt.toISOString(), id: last.id }) : null;

  const data: ContactRow[] = page.map((c) => {
    const email = c.emails[0]?.email;
    const check = email?.verifications[0];
    return {
      id: c.id,
      email: email?.normalized ?? null,
      phone: c.phoneE164 ?? c.phoneRaw,
      formUrl: c.contactFormUrl,
      name: c.fullName ?? ([c.firstName, c.lastName].filter(Boolean).join(" ") || null),
      jobTitle: c.jobTitle,
      category: c.category,
      roleBased: c.isRoleBased,
      companyId: c.company.id,
      company: c.company.name,
      country: c.company.countryCode,
      emailStatus: email?.status ?? null,
      syntax: check?.syntaxStatus ?? null,
      mx: check?.mxStatus ?? null,
      sourceUrl: c.evidence[0]?.pageUrl ?? c.sourceUrl,
      method: c.evidence[0]?.method ?? null,
      confidence: c.confidence,
      observedAt: (c.evidence[0]?.observedAt ?? c.observedAt).toISOString(),
    };
  });
  const filterParams = new URLSearchParams(Object.entries(raw).filter(([k, v]) => v && k !== "cursor") as [string, string][]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contacts"
        description={`${total.toLocaleString("en")} contacts. Syntax and MX checks are not proof a mailbox exists, and finding a contact does not grant permission to market to it.`}
        actions={<a className="btn" href={`/api/v1/export/contacts?${filterParams}`}>Export CSV</a>}
      />
      <form className="card grid gap-2 p-3 text-sm md:grid-cols-6" method="get">
        <input name="q" defaultValue={query.q} placeholder="Search email, name, title, company" className="input md:col-span-2" />
        <select name="category" defaultValue={query.category ?? ""} className="input">
          <option value="">Any category</option>
          {CONTACT_CATEGORIES.map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}
        </select>
        <select name="emailStatus" defaultValue={query.emailStatus ?? ""} className="input">
          <option value="">Any email status</option>
          {["DISCOVERED", "SYNTAX_VALID", "DNS_VALID", "MX_VALID", "DELIVERABILITY_UNKNOWN", "RISKY", "UNDELIVERABLE", "SUPPRESSED"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select name="hasPhone" defaultValue={query.hasPhone ?? ""} className="input">
          <option value="">Phone: any</option>
          <option value="true">Has phone</option>
          <option value="false">No phone</option>
        </select>
        <input name="country" defaultValue={query.country} placeholder="Country (SE)" className="input" maxLength={2} />
        {query.projectId ? <input type="hidden" name="projectId" value={query.projectId} /> : null}
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary">Filter</button>
          <Link href="/contacts" className="btn">Reset</Link>
        </div>
      </form>
      <Card>
        <ContactsTable rows={data} />
        <div className="flex justify-between border-t border-[var(--lf-line)] px-4 py-2 text-xs">
          <span className="muted">{page.length} shown</span>
          {next ? <Link className="underline" href={`/contacts?${new URLSearchParams({ ...Object.fromEntries(filterParams), cursor: next })}`}>Next page →</Link> : null}
        </div>
      </Card>
    </div>
  );
}
