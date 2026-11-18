/**
 * Idempotent development seed.
 *
 * Creates one organization, an owner and an analyst, a permitted source and a
 * small demo dataset so every screen has something to show. It deliberately
 * does NOT approve any jurisdiction profile: legal sign-off is a human action.
 */
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { argon2id } from "hash-wasm";

const prisma = new PrismaClient();

async function hash(password) {
  return argon2id({
    password,
    salt: randomBytes(16),
    parallelism: 1,
    iterations: 3,
    memorySize: 65536,
    hashLength: 32,
    outputType: "encoded",
  });
}

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: "leadforge-demo" },
    create: { name: "LeadForge Demo", slug: "leadforge-demo", countryCode: "SE" },
    update: {},
  });

  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@leadforge.local").toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    create: { email: adminEmail, name: "Owner", passwordHash: await hash(adminPassword) },
    update: {},
  });

  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: admin.id, organizationId: org.id } },
    create: { userId: admin.id, organizationId: org.id, role: "OWNER" },
    update: { role: "OWNER" },
  });

  const analystEmail = "analyst@leadforge.local";
  const analyst = await prisma.user.upsert({
    where: { email: analystEmail },
    create: { email: analystEmail, name: "Analyst", passwordHash: await hash(adminPassword) },
    update: {},
  });
  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: analyst.id, organizationId: org.id } },
    create: { userId: analyst.id, organizationId: org.id, role: "ANALYST" },
    update: { role: "ANALYST" },
  });

  const permittedSource = await prisma.source.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "User-provided domains" } },
    create: {
      organizationId: org.id,
      name: "User-provided domains",
      sourceType: "IMPORT",
      permitted: true,
      policyNotes: "Domains explicitly supplied by the operator; only public pages are fetched.",
      tosReviewedAt: new Date(),
      reviewedBy: admin.id,
      rateLimit: 1,
    },
    update: { permitted: true },
  });

  const demo = [
    { name: "Nordvind AB", domain: "example.com", countryCode: "SE", industry: "Manufacturing" },
    { name: "Brightpath Ltd", domain: "example.org", countryCode: "GB", industry: "Consulting" },
    { name: "Kontor GmbH", domain: "example.net", countryCode: "DE", industry: "Logistics" },
  ];

  for (const entry of demo) {
    const domain = await prisma.domain.upsert({
      where: { domain: entry.domain },
      create: {
        domain: entry.domain,
        registrableDomain: entry.domain,
        tld: entry.domain.split(".").pop() ?? "",
      },
      update: {},
    });

    const company = await prisma.company.upsert({
      where: {
        organizationId_name_countryCode: {
          organizationId: org.id,
          name: entry.name,
          countryCode: entry.countryCode,
        },
      },
      create: {
        organizationId: org.id,
        name: entry.name,
        countryCode: entry.countryCode,
        industry: entry.industry,
        website: `https://${entry.domain}`,
        confidence: 0.8,
      },
      update: { lastSeenAt: new Date() },
    });

    await prisma.companyDomain.upsert({
      where: { domainId: domain.id },
      create: {
        companyId: company.id,
        domainId: domain.id,
        isPrimary: true,
        verifiedAt: new Date(),
      },
      update: {},
    });

    await prisma.sourceEvidence.create({
      data: {
        organizationId: org.id,
        companyId: company.id,
        domainId: domain.id,
        sourceId: permittedSource.id,
        pageUrl: `https://${entry.domain}`,
        fieldName: "domain",
        extractedValue: entry.domain,
        method: "seed",
        extractorVersion: "seed",
      },
    });

    const emailAddress = `info@${entry.domain}`;
    const email = await prisma.emailAddress.upsert({
      where: { normalized: emailAddress },
      create: {
        address: emailAddress,
        normalized: emailAddress,
        localPart: "info",
        domain: entry.domain,
        status: "MX_VALID",
        isRoleAccount: true,
        lastVerifiedAt: new Date(),
        verificationExpiresAt: new Date(Date.now() + 90 * 86_400_000),
      },
      update: {},
    });

    const contact = await prisma.contact.upsert({
      where: { id: `seed-contact-${company.id}` },
      create: {
        id: `seed-contact-${company.id}`,
        organizationId: org.id,
        companyId: company.id,
        type: "GENERIC_BUSINESS",
        confidence: 0.8,
      },
      update: {},
    });

    await prisma.contactEmail.upsert({
      where: { contactId_emailId: { contactId: contact.id, emailId: email.id } },
      create: { contactId: contact.id, emailId: email.id, isPrimary: true, confidence: 0.8 },
      update: {},
    });
  }

  await prisma.emailTemplate.upsert({
    where: { organizationId_name_version: { organizationId: org.id, name: "Intro", version: 1 } },
    create: {
      organizationId: org.id,
      name: "Intro",
      subject: "Quick question about {{company}}",
      html: "<p>Hi {{first_name}},</p><p>…</p>",
      text: "Hi {{first_name}},\n\n…",
      variables: ["first_name", "company"],
    },
    update: {},
  });

  console.log(`seeded organization ${org.slug}`);
  console.log(`  owner:    ${adminEmail} / ${adminPassword}`);
  console.log(`  analyst:  ${analystEmail} / ${adminPassword}`);
  console.log("  jurisdiction profiles remain DRAFT until approved in Settings.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
