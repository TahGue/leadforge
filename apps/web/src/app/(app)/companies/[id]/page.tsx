import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@leadforge/database";
import { requireSession } from "@/lib/auth";
import { ActionButton } from "@/components/action-button";

export const dynamic = "force-dynamic";

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;

  const company = await prisma.company.findFirst({
    where: { id, organizationId: session.organization.id },
    include: {
      domains: { include: { domain: true } },
      contacts: {
        include: {
          emails: {
            include: {
              email: { include: { verifications: { orderBy: { checkedAt: "desc" }, take: 1 } } },
            },
          },
        },
      },
      evidence: { orderBy: { observedAt: "desc" }, take: 50 },
    },
  });

  if (!company) notFound();

  return (
    <div className="space-y-6">
      <header>
        <Link href="/companies" className="text-xs muted hover:underline">
          ← Companies
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{company.name}</h1>
        <p className="mt-1 text-sm muted">
          {company.domains[0]?.domain.domain ?? "No domain"} · {company.countryCode ?? "country unknown"} ·{" "}
          {company.industry ?? "industry unknown"}
        </p>
      </header>

      <section className="card overflow-hidden">
        <h2 className="border-b border-[var(--lf-line)] px-4 py-3 text-sm font-semibold">
          Contacts ({company.contacts.length})
        </h2>
        {company.contacts.length === 0 ? (
          <p className="px-4 py-6 text-sm muted">
            No contacts yet. Crawl the domain, then promote candidates from the review queue.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Email</th>
                <th>Status</th>
                <th>Verified</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {company.contacts.flatMap((contact) =>
                contact.emails.map((link) => (
                  <tr key={link.emailId}>
                    <td>
                      {contact.type === "GENERIC_BUSINESS"
                        ? "General inbox"
                        : [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
                          "Unnamed contact"}
                      {contact.jobTitle ? (
                        <span className="ml-2 text-xs muted">{contact.jobTitle}</span>
                      ) : null}
                    </td>
                    <td className="font-mono text-xs">{link.email.normalized}</td>
                    <td>
                      <span
                        className={`badge ${
                          link.email.status === "MX_VALID"
                            ? "badge-green"
                            : link.email.status === "UNDELIVERABLE" || link.email.status === "SUPPRESSED"
                              ? "badge-red"
                              : "badge-amber"
                        }`}
                      >
                        {link.email.status}
                      </span>
                    </td>
                    <td className="text-xs muted">
                      {link.email.verificationExpiresAt
                        ? `expires ${link.email.verificationExpiresAt.toISOString().slice(0, 10)}`
                        : "never"}
                    </td>
                    <td>
                      <ActionButton
                        url="/api/v1/emails/verify"
                        body={{ emailId: link.emailId }}
                        label="Verify"
                        pendingLabel="Checking…"
                      />
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        )}
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-[var(--lf-line)] px-4 py-3 text-sm font-semibold">
          Evidence ({company.evidence.length})
        </h2>
        <table className="table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Value</th>
              <th>Method</th>
              <th>Observed</th>
            </tr>
          </thead>
          <tbody>
            {company.evidence.map((row) => (
              <tr key={row.id}>
                <td className="text-xs">{row.fieldName}</td>
                <td className="max-w-[28rem] truncate font-mono text-xs">{row.extractedValue}</td>
                <td className="text-xs muted">{row.method}</td>
                <td className="text-xs muted">{row.observedAt.toISOString().slice(0, 16)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
