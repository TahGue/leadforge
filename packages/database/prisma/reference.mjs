/**
 * Idempotent reference-data loader: geography seed and industry taxonomy.
 *
 * Safe to run on every deploy (the compose `migrate` service runs it after
 * `prisma migrate deploy`). It never touches tenant data.
 *
 *   node packages/database/prisma/reference.mjs
 *
 * Countries and continents are inserted by the realign migration; this script
 * adds regions, cities, aliases and the versioned taxonomy.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.LEADFORGE_DATA_DIR ?? join(here, "../../../data");
const prisma = new PrismaClient();

/** Must match normalizeName() in @leadforge/shared and normalize_name() in Python. */
export function normalizeName(value) {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ø/gi, "o")
    .replace(/æ/gi, "ae")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function readTsv(relative) {
  const [header, ...lines] = readFileSync(join(dataDir, relative), "utf8")
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  const keys = header.split("\t");
  return lines.map((line) => {
    const cells = line.split("\t");
    return Object.fromEntries(keys.map((key, i) => [key, cells[i] ?? ""]));
  });
}

async function alias(entityType, entityId, name, language = null) {
  const normalized = normalizeName(name);
  if (!normalized) return;
  await prisma.geoAlias.upsert({
    where: { entityType_entityId_normalized: { entityType, entityId, normalized } },
    create: { entityType, entityId, name, normalized, language },
    update: {},
  });
}

async function seedGeography() {
  const batch = await prisma.geoImportBatch.upsert({
    where: { id: "leadforge-geo-seed-1" },
    create: {
      id: "leadforge-geo-seed-1",
      source: "LeadForge bundled seed",
      version: "1",
      licence: "ISO 3166-2 codes; coordinates approximate",
      attribution: "ISO 3166 Maintenance Agency. City centroids approximate; import GeoNames (CC BY 4.0) for authoritative data.",
      fileName: "data/geography/seed/{regions,cities}.tsv",
      notes: "Initial coverage: SE, NO, DK, FI, DE, GB.",
    },
    update: {},
  });

  for (const country of await prisma.country.findMany({ select: { iso2: true, name: true } })) {
    await alias("COUNTRY", country.iso2, country.name, "en");
    await alias("COUNTRY", country.iso2, country.iso2);
  }
  await alias("COUNTRY", "GB", "UK");
  await alias("COUNTRY", "GB", "Great Britain");
  await alias("COUNTRY", "SE", "Sverige", "sv");
  await alias("COUNTRY", "NO", "Norge", "no");
  await alias("COUNTRY", "DK", "Danmark", "da");
  await alias("COUNTRY", "FI", "Suomi", "fi");
  await alias("COUNTRY", "DE", "Deutschland", "de");

  const regions = readTsv("geography/seed/regions.tsv");
  const regionIds = new Map();
  for (const row of regions) {
    const region = await prisma.adminRegion.upsert({
      where: { countryIso2_code: { countryIso2: row.country, code: row.iso_code } },
      create: {
        countryIso2: row.country,
        code: row.iso_code,
        isoCode: row.iso_code,
        name: row.name,
        asciiName: row.ascii_name,
        importBatchId: batch.id,
      },
      update: { name: row.name, asciiName: row.ascii_name, isoCode: row.iso_code },
    });
    regionIds.set(row.iso_code, region.id);
    await alias("REGION", region.id, row.name);
    await alias("REGION", region.id, row.ascii_name);
    // "Västra Götalands län" is commonly written "Västra Götaland".
    const short = row.name.replace(/s? län$/u, "").replace(/^Region /u, "");
    if (short !== row.name) await alias("REGION", region.id, short);
  }

  const cities = readTsv("geography/seed/cities.tsv");
  for (const row of cities) {
    const externalId = `seed:${row.country}:${row.slug}`;
    const city = await prisma.city.upsert({
      where: { externalId },
      create: {
        externalId,
        countryIso2: row.country,
        regionId: regionIds.get(row.region_iso) ?? null,
        name: row.name,
        asciiName: row.ascii_name,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        population: row.population ? Number(row.population) : null,
        importBatchId: batch.id,
      },
      update: {
        name: row.name,
        asciiName: row.ascii_name,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        regionId: regionIds.get(row.region_iso) ?? null,
      },
    });
    await alias("CITY", city.id, row.name);
    await alias("CITY", city.id, row.ascii_name);
    for (const extra of (row.aliases ?? "").split("|").filter(Boolean)) {
      await alias("CITY", city.id, extra);
    }
  }

  await prisma.geoImportBatch.update({
    where: { id: batch.id },
    data: { rowCount: regions.length + cities.length },
  });
  return { regions: regions.length, cities: cities.length };
}

async function seedTaxonomy() {
  const file = JSON.parse(readFileSync(join(dataDir, "taxonomy/leadforge-v1.json"), "utf8"));
  const version = await prisma.industryTaxonomyVersion.upsert({
    where: { taxonomy_version: { taxonomy: file.taxonomy, version: file.version } },
    create: { taxonomy: file.taxonomy, version: file.version, isCurrent: true, notes: file.notes },
    update: { isCurrent: true, notes: file.notes },
  });
  await prisma.industryTaxonomyVersion.updateMany({
    where: { taxonomy: file.taxonomy, NOT: { id: version.id } },
    data: { isCurrent: false },
  });

  let count = 0;
  async function upsertNode(node, parentId, level) {
    const industry = await prisma.industry.upsert({
      where: { versionId_code: { versionId: version.id, code: node.code } },
      create: { versionId: version.id, code: node.code, name: node.name, parentId, level },
      update: { name: node.name, parentId, level, isActive: true },
    });
    count += 1;
    for (const code of node.nace ?? []) {
      await prisma.industryExternalCode.upsert({
        where: { industryId_scheme_code: { industryId: industry.id, scheme: "NACE", code } },
        create: { industryId: industry.id, scheme: "NACE", schemeVersion: "Rev. 2", code },
        update: {},
      });
    }
    for (const name of [node.name, ...(node.aliases ?? [])]) {
      const normalized = normalizeName(name);
      if (!normalized) continue;
      await prisma.industryAlias.upsert({
        where: { industryId_normalized: { industryId: industry.id, normalized } },
        create: { industryId: industry.id, alias: name, normalized },
        update: {},
      });
    }
    for (const child of node.children ?? []) await upsertNode(child, industry.id, level + 1);
  }
  for (const sector of file.sectors) await upsertNode(sector, null, 0);
  return { industries: count, version: `${file.taxonomy} ${file.version}` };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    const geo = await seedGeography();
    const tax = await seedTaxonomy();
    console.log(
      `reference data: ${geo.regions} regions, ${geo.cities} cities, ${tax.industries} industries (${tax.version})`,
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
