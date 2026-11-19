/**
 * Idempotent development seed.
 *
 * Creates one organization, an owner and an analyst, the built-in user source,
 * two registry sources awaiting policy review, and a
 * small demo dataset so every screen has something to show. Run reference.mjs first. It deliberately
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

  const userSource = await prisma.source.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "User-provided domains" } },
    create: {
      organizationId: org.id,
      name: "User-provided domains",
      sourceType: "IMPORT",
      adapter: "domain_list",
      permitted: true,
      policyStatus: "APPROVED",
      automatedAccessAllowed: true,
      commercialReuseAllowed: true,
      permittedUse: "Domains and company records supplied by the operator. Only public pages of these sites are crawled.",
      policyNotes: "Built-in source for operator-supplied data.",
      tosReviewedAt: new Date(),
      reviewedBy: admin.id,
      rateLimit: 1,
    },
    update: { adapter: "domain_list", permitted: true, policyStatus: "APPROVED" },
  });

  // Registered but NOT approved: a person must review terms and licence first (spec 10).
  await prisma.source.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "Open company dataset (file)" } },
    create: {
      organizationId: org.id,
      name: "Open company dataset (file)",
      sourceType: "DATASET",
      adapter: "open_dataset",
      policyStatus: "UNREVIEWED",
      policyNotes:
        "Reads a registry or open-data export placed under data/imports/. Record the dataset licence and terms before approving.",
      config: { path: "data/imports/sample-registry.csv", format: "csv" },
    },
    update: {},
  });
  await prisma.source.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "OpenStreetMap (Overpass API)" } },
    create: {
      organizationId: org.id,
      name: "OpenStreetMap (Overpass API)",
      sourceType: "DIRECTORY",
      adapter: "osm_overpass",
      baseUrl: "https://overpass-api.de/api/interpreter",
      tosUrl: "https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances",
      licenceName: "ODbL 1.0",
      licenceUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
      attribution: "© OpenStreetMap contributors",
      policyStatus: "UNREVIEWED",
      policyNotes:
        "Public Overpass instances are shared and rate limited; prefer a self-hosted instance for volume. ODbL requires attribution and share-alike for derived databases.",
      rateLimitJson: { requestsPerMinute: 2 },
      config: { endpoint: "https://overpass-api.de/api/interpreter", timeoutSeconds: 60 },
    },
    update: {},
  });

  const version = await prisma.industryTaxonomyVersion.findFirst({ where: { isCurrent: true } });
  const industryByCode = async (code) =>
    version
      ? prisma.industry.findUnique({ where: { versionId_code: { versionId: version.id, code } } })
      : null;

  const demo = [
    { name: "Nordvind AB", domain: "example.com", countryCode: "SE", city: "seed:SE:goteborg", industry: "manufacturing.machinery", label: "Manufacturing" },
    { name: "Brightpath Ltd", domain: "example.org", countryCode: "GB", city: "seed:GB:london", industry: "professional-services.management-consulting", label: "Consulting" },
    { name: "Kontor GmbH", domain: "example.net", countryCode: "DE", city: "seed:DE:hamburg", industry: "logistics-transport.road-freight", label: "Logistics" },
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

    const link = await prisma.companyDomain.findUnique({ where: { domainId: domain.id } });
    const company = link
      ? await prisma.company.update({ where: { id: link.companyId }, data: { lastSeenAt: new Date() } })
      : await prisma.company.create({
          data: {
            organizationId: org.id,
            name: entry.name,
            normalizedName: entry.name.toLowerCase().replace(/\s+(ab|ltd|gmbh)$/, ""),
            countryCode: entry.countryCode,
            industryLabel: entry.label,
            website: `https://${entry.domain}`,
            confidence: 0.8,
          },
        });

    if (!link) {
      await prisma.companyDomain.create({
        data: { companyId: company.id, domainId: domain.id, isPrimary: true, verifiedAt: new Date() },
      });
      await prisma.sourceEvidence.create({
        data: {
          organizationId: org.id,
          companyId: company.id,
          domainId: domain.id,
          sourceId: userSource.id,
          pageUrl: `https://${entry.domain}`,
          fieldName: "domain",
          extractedValue: entry.domain,
          method: "seed",
          extractorVersion: "seed",
        },
      });
      const city = await prisma.city.findUnique({ where: { externalId: entry.city } });
      if (city) {
        await prisma.companyLocation.create({
          data: {
            companyId: company.id,
            locationType: "HEADQUARTERS",
            isHeadquarters: true,
            countryIso2: entry.countryCode,
            regionId: city.regionId,
            cityId: city.id,
            latitude: city.latitude,
            longitude: city.longitude,
            sourceId: userSource.id,
            confidence: 0.9,
            resolution: "RESOLVED",
          },
        });
      }
      const industry = await industryByCode(entry.industry);
      if (industry) {
        await prisma.companyIndustry.create({
          data: {
            companyId: company.id,
            industryId: industry.id,
            isPrimary: true,
            confidence: 0.9,
            method: "MANUAL",
            sourceId: userSource.id,
          },
        });
      }
    }

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
        category: "GENERAL",
        isRoleBased: true,
        sourceUrl: `https://${entry.domain}/contact`,
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
