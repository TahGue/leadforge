#!/usr/bin/env node
/**
 * Load test at the spec's first scale milestone (spec 22: 100,000 records).
 *
 *   node scripts/load-test.mjs generate --companies 100000   # synthetic org "loadtest" (safe to delete)
 *   node scripts/load-test.mjs measure                       # time the hot queries
 *   node scripts/load-test.mjs cleanup
 *
 * Data is synthetic (".invalid" domains, reserved by RFC 2606) and lives in its
 * own organization so it never mixes with real records.
 */
import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const [command = "measure", ...rest] = process.argv.slice(2);
const companies = Number(rest[rest.indexOf("--companies") + 1] ?? 100_000) || 100_000;
const SLUG = "loadtest";

async function org() {
  return prisma.organization.upsert({ where: { slug: SLUG }, create: { name: "Load test (synthetic)", slug: SLUG }, update: {} });
}

async function generate() {
  const { id } = await org();
  const started = performance.now();
  // Set-based SQL keeps generation fast: companies, domains, locations, industries, contacts, emails.
  await prisma.$executeRawUnsafe(`
    WITH cities AS (SELECT id, "countryIso2", "regionId", latitude, longitude, row_number() OVER (ORDER BY id) AS n FROM "City"),
         ncity AS (SELECT count(*) AS c FROM cities),
         subs AS (SELECT id, row_number() OVER (ORDER BY id) AS n FROM "Industry" WHERE level = 1),
         nsub AS (SELECT count(*) AS c FROM subs)
    INSERT INTO "Company" (id, "organizationId", name, "normalizedName", description, "countryCode", website, status, "reviewStatus",
                           confidence, "createdAt", "updatedAt", "lastSeenAt", tags)
    SELECT 'lt-c-' || g, '${id}', 'Loadtest Company ' || g, 'loadtest company ' || g,
           'Synthetic company number ' || g || ' providing construction, software and logistics services',
           (SELECT "countryIso2" FROM cities, ncity WHERE cities.n = 1 + (g % ncity.c)),
           'https://lt' || g || '.invalid', 'ACTIVE', 'UNREVIEWED', (g % 100) / 100.0, now(), now() - (g % 400) * interval '1 day', now() - (g % 400) * interval '1 day', '{}'
    FROM generate_series(1, ${companies}) g
    ON CONFLICT DO NOTHING`);
  await prisma.$executeRawUnsafe(`
    WITH cities AS (SELECT id, "countryIso2", "regionId", latitude, longitude, row_number() OVER (ORDER BY id) AS n FROM "City"),
         ncity AS (SELECT count(*) AS c FROM cities)
    INSERT INTO "CompanyLocation" (id, "companyId", "locationType", "isHeadquarters", "countryIso2", "regionId", "cityId", latitude, longitude, confidence, resolution)
    SELECT 'lt-l-' || g, 'lt-c-' || g, 'HEADQUARTERS', true, c."countryIso2", c."regionId", c.id, c.latitude, c.longitude, 0.9, 'RESOLVED'
    FROM generate_series(1, ${companies}) g, ncity JOIN cities c ON true
    WHERE c.n = 1 + (g % ncity.c)
    ON CONFLICT DO NOTHING`);
  await prisma.$executeRawUnsafe(`
    WITH subs AS (SELECT id, row_number() OVER (ORDER BY id) AS n FROM "Industry" WHERE level = 1), nsub AS (SELECT count(*) AS c FROM subs)
    INSERT INTO "CompanyIndustry" (id, "companyId", "industryId", "isPrimary", confidence, method, "createdAt", "updatedAt")
    SELECT 'lt-i-' || g, 'lt-c-' || g, s.id, true, 0.8, 'SOURCE', now(), now()
    FROM generate_series(1, ${companies}) g, nsub JOIN subs s ON true WHERE s.n = 1 + (g % nsub.c)
    ON CONFLICT DO NOTHING`);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Contact" (id, "organizationId", "companyId", type, category, "isRoleBased", "sourceUrl", confidence, status, "observedAt", "createdAt", "updatedAt", tags)
    SELECT 'lt-k-' || g, '${id}', 'lt-c-' || g, 'GENERIC_BUSINESS', 'GENERAL', true, 'https://lt' || g || '.invalid/contact', 0.9, 'ACTIVE', now(), now(), now(), '{}'
    FROM generate_series(1, ${companies}) g ON CONFLICT DO NOTHING`);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "EmailAddress" (id, address, normalized, "localPart", domain, status, "isRoleAccount", "createdAt", "updatedAt")
    SELECT 'lt-e-' || g, 'info@lt' || g || '.invalid', 'info@lt' || g || '.invalid', 'info', 'lt' || g || '.invalid',
           (ARRAY['MX_VALID','SYNTAX_VALID','DISCOVERED','UNDELIVERABLE'])[1 + g % 4]::"EmailStatus", true, now(), now()
    FROM generate_series(1, ${companies}) g ON CONFLICT DO NOTHING`);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "ContactEmail" ("contactId", "emailId", "isPrimary", label, confidence, "createdAt")
    SELECT 'lt-k-' || g, 'lt-e-' || g, true, 'WORK', 0.9, now() FROM generate_series(1, ${companies}) g ON CONFLICT DO NOTHING`);
  await prisma.$executeRawUnsafe(`ANALYZE`);
  console.log(`generated ${companies} companies + locations, industries, contacts, emails in ${((performance.now() - started) / 1000).toFixed(1)} s`);
}

async function time(label, fn, runs = 5) {
  await fn(); // warm
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    const t = performance.now();
    await fn();
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(samples.length / 2)];
  const max = samples[samples.length - 1];
  console.log(`${label.padEnd(58)} p50 ${p50.toFixed(1).padStart(7)} ms   max ${max.toFixed(1).padStart(7)} ms`);
  return { label, p50, max };
}

async function measure() {
  const { id } = await org();
  const total = await prisma.company.count({ where: { organizationId: id } });
  console.log(`measuring with ${total} companies in the load-test organization\n`);
  const city = await prisma.city.findFirst({ where: { externalId: "seed:SE:goteborg" } });
  const sub = await prisma.industry.findFirst({ where: { level: 1 } });
  const results = [
    await time("companies list, newest first (page of 50)", () =>
      prisma.company.findMany({ where: { organizationId: id, deletedAt: null }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 51 })),
    await time("companies by country (count)", () => prisma.company.count({ where: { organizationId: id, countryCode: "SE" } })),
    await time("companies in a city (page of 50)", () =>
      prisma.company.findMany({ where: { organizationId: id, locations: { some: { cityId: city?.id } } }, take: 51 })),
    await time("companies in a subsector (page of 50)", () =>
      prisma.company.findMany({ where: { organizationId: id, industries: { some: { industryId: sub?.id } } }, take: 51 })),
    await time("full-text search", () =>
      prisma.$queryRaw`SELECT id FROM "Company" WHERE "organizationId" = ${id} AND "searchVector" @@ websearch_to_tsquery('simple', 'logistics') LIMIT 2000`),
    await time("radius query: companies within 25 km (PostGIS)", () =>
      prisma.$queryRaw`SELECT count(*) FROM "CompanyLocation" l WHERE ST_DWithin(l.geog, ST_SetSRID(ST_MakePoint(11.97, 57.71), 4326)::geography, 25000)`),
    await time("contacts with MX-valid email (page of 50)", () =>
      prisma.contact.findMany({ where: { organizationId: id, emails: { some: { email: { status: "MX_VALID" } } } }, take: 51 })),
    await time("dashboard: email status breakdown", () =>
      prisma.emailAddress.groupBy({ by: ["status"], where: { contacts: { some: { contact: { organizationId: id } } } }, _count: { _all: true } })),
    await time("stale companies count", () =>
      prisma.company.count({ where: { organizationId: id, lastSeenAt: { lt: new Date(Date.now() - 180 * 86_400_000) } } })),
  ];
  const slow = results.filter((r) => r.p50 > 500);
  console.log(`\n${slow.length ? `SLOW (>500 ms p50): ${slow.map((s) => s.label).join("; ")}` : "all hot queries under 500 ms p50"}`);
  process.exitCode = slow.length ? 1 : 0;
}

async function cleanup() {
  const existing = await prisma.organization.findUnique({ where: { slug: SLUG } });
  if (!existing) return console.log("nothing to clean");
  await prisma.$executeRawUnsafe(`DELETE FROM "ContactEmail" WHERE "emailId" LIKE 'lt-e-%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM "EmailAddress" WHERE id LIKE 'lt-e-%'`);
  await prisma.organization.delete({ where: { id: existing.id } });
  console.log("removed load-test organization and its records");
}

const commands = { generate, measure, cleanup };
if (!commands[command]) {
  console.error("usage: load-test.mjs generate|measure|cleanup [--companies N]");
  process.exit(2);
}
await commands[command]();
await prisma.$disconnect();
