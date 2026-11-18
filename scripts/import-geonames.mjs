#!/usr/bin/env node
/**
 * Import GeoNames reference data (ADR-0024). GeoNames is CC BY 4.0: the import
 * batch records the licence and attribution, shown in Settings.
 *
 * Download from https://download.geonames.org/export/dump/ (operator action):
 *   countryInfo.txt, admin1CodesASCII.txt, and cities1000.zip / cities5000.zip /
 *   cities15000.zip (unzipped to citiesNNNN.txt), optionally alternateNamesV2 is
 *   not needed: city alternate names come from the cities file itself.
 *
 *   node scripts/import-geonames.mjs --dir ./geonames --countries SE,NO,DK,FI,DE,GB --cities cities1000.txt
 *
 * Idempotent: cities upsert on externalId "geonames:<id>"; regions on (country, admin1 code).
 * Bundled seed cities stay; when a GeoNames city has the same name and region,
 * companies keep pointing at the seed row (no destructive merge).
 */
import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PrismaClient } from "@prisma/client";
import { normalizeName } from "../packages/database/prisma/reference.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1]?.startsWith("--") ? "true" : all[index + 1]]);
    return pairs;
  }, []),
);
const dir = args.dir ?? "geonames";
const countries = args.countries ? new Set(args.countries.split(",").map((c) => c.trim().toUpperCase())) : null;
const citiesFile = args.cities ?? "cities15000.txt";
const prisma = new PrismaClient();

async function* rows(file) {
  const path = join(dir, file);
  if (!existsSync(path)) throw new Error(`missing ${path}; download it from https://download.geonames.org/export/dump/`);
  const reader = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line || line.startsWith("#")) continue;
    yield line.split("\t");
  }
}

async function alias(entityType, entityId, name) {
  const normalized = normalizeName(name);
  if (!normalized || normalized.length > 200) return;
  await prisma.geoAlias.upsert({
    where: { entityType_entityId_normalized: { entityType, entityId, normalized } },
    create: { entityType, entityId, name: name.slice(0, 200), normalized },
    update: {},
  });
}

async function main() {
  const batch = await prisma.geoImportBatch.create({
    data: {
      source: "GeoNames",
      version: new Date().toISOString().slice(0, 10),
      licence: "CC BY 4.0",
      attribution: "GeoNames (https://www.geonames.org/), licensed under CC BY 4.0",
      fileName: `countryInfo.txt, admin1CodesASCII.txt, ${citiesFile}`,
      notes: countries ? `countries: ${[...countries].join(",")}` : "all countries",
    },
  });

  let countryCount = 0;
  for await (const c of rows("countryInfo.txt")) {
    const [iso2, iso3, numeric, , name, capital, , population, continent, , , , , , , , geonameId] = c;
    if (countries && !countries.has(iso2)) continue;
    const continentCode = continent === "NA" ? "NA" : continent;
    await prisma.country.upsert({
      where: { iso2 },
      create: { iso2, iso3, isoNumeric: Number(numeric) || null, name, continentCode, capital: capital || null, population: population ? BigInt(population) : null, geonameId: Number(geonameId) || null, importBatchId: batch.id },
      update: { capital: capital || null, population: population ? BigInt(population) : null, geonameId: Number(geonameId) || null, importBatchId: batch.id },
    });
    countryCount += 1;
  }

  const regionIds = new Map();
  let regionCount = 0;
  for await (const r of rows("admin1CodesASCII.txt")) {
    const [code, name, asciiName, geonameId] = r;
    const [iso2, admin1] = code.split(".");
    if (countries && !countries.has(iso2)) continue;
    const existing = await prisma.adminRegion.findFirst({
      where: { countryIso2: iso2, OR: [{ code }, { geonameId: Number(geonameId) }, { asciiName }] },
    });
    const region = existing
      ? await prisma.adminRegion.update({ where: { id: existing.id }, data: { geonameId: Number(geonameId), asciiName: existing.asciiName ?? asciiName } })
      : await prisma.adminRegion.create({ data: { countryIso2: iso2, code, name, asciiName, geonameId: Number(geonameId), importBatchId: batch.id } });
    regionIds.set(`${iso2}.${admin1}`, region.id);
    await alias("REGION", region.id, name);
    await alias("REGION", region.id, asciiName);
    regionCount += 1;
  }

  let cityCount = 0;
  for await (const c of rows(citiesFile)) {
    const [geonameId, name, asciiName, alternates, lat, lon, , , iso2, , admin1, , , , population, , , timezone] = c;
    if (countries && !countries.has(iso2)) continue;
    const regionId = regionIds.get(`${iso2}.${admin1}`) ?? null;
    const city = await prisma.city.upsert({
      where: { externalId: `geonames:${geonameId}` },
      create: {
        externalId: `geonames:${geonameId}`,
        geonameId: Number(geonameId),
        countryIso2: iso2,
        regionId,
        name,
        asciiName,
        latitude: Number(lat),
        longitude: Number(lon),
        population: Number(population) || null,
        timezone: timezone || null,
        importBatchId: batch.id,
      },
      update: { name, asciiName, latitude: Number(lat), longitude: Number(lon), population: Number(population) || null, regionId },
    });
    await alias("CITY", city.id, name);
    await alias("CITY", city.id, asciiName);
    for (const alt of (alternates ?? "").split(",").filter(Boolean).slice(0, 15)) await alias("CITY", city.id, alt);
    cityCount += 1;
    if (cityCount % 1000 === 0) console.log(`  ${cityCount} cities`);
  }

  await prisma.geoImportBatch.update({ where: { id: batch.id }, data: { rowCount: countryCount + regionCount + cityCount } });
  console.log(`GeoNames import: ${countryCount} countries, ${regionCount} regions, ${cityCount} cities (batch ${batch.id})`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
