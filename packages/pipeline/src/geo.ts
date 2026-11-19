/**
 * Geography resolution and project scope matching (spec sections 5.1 and 6).
 *
 * Free-text place names are only ever resolved through GeoAlias within a known
 * country, so "Lund" in Sweden never matches a "Lund" elsewhere. Anything that
 * cannot be resolved unambiguously is left UNRESOLVED/AMBIGUOUS for review.
 */
import { Prisma, prisma, type DiscoveryLocation } from "@leadforge/database";
import { haversineKm, normalizeName } from "@leadforge/shared";

type Db = Prisma.TransactionClient | typeof prisma;

export interface LocationInput {
  countryIso2?: string | null;
  countryName?: string | null;
  regionName?: string | null;
  cityName?: string | null;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface ResolvedLocation {
  countryIso2: string | null;
  continentCode: string | null;
  regionId: string | null;
  cityId: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  resolution: "RESOLVED" | "UNRESOLVED" | "AMBIGUOUS";
  confidence: number;
}

const NEARBY_KM = 25;
const NEAREST_CITY_MAX_KM = 30;

async function aliasIds(db: Db, entityType: string, name: string): Promise<string[]> {
  const normalized = normalizeName(name);
  if (!normalized) return [];
  const rows = await db.geoAlias.findMany({
    where: { entityType, normalized },
    select: { entityId: true },
    take: 50,
  });
  return [...new Set(rows.map((r) => r.entityId))];
}

export async function resolveCountry(db: Db, value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    const iso = trimmed.toUpperCase() === "UK" ? "GB" : trimmed.toUpperCase();
    const country = await db.country.findUnique({ where: { iso2: iso }, select: { iso2: true } });
    if (country) return country.iso2;
  }
  const ids = await aliasIds(db, "COUNTRY", trimmed);
  return ids.length === 1 ? ids[0]! : null;
}

export async function resolveLocation(db: Db, input: LocationInput): Promise<ResolvedLocation> {
  const result: ResolvedLocation = {
    countryIso2: null,
    continentCode: null,
    regionId: null,
    cityId: null,
    postalCode: input.postalCode?.trim() || null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    resolution: "UNRESOLVED",
    confidence: 0,
  };

  result.countryIso2 =
    (await resolveCountry(db, input.countryIso2)) ?? (await resolveCountry(db, input.countryName));
  if (!result.countryIso2) {
    if (result.latitude !== null && result.longitude !== null) {
      await nearestCity(db, result);
    }
    return result;
  }

  const country = await db.country.findUnique({
    where: { iso2: result.countryIso2 },
    select: { continentCode: true },
  });
  result.continentCode = country?.continentCode ?? null;
  result.confidence = 0.5;

  if (input.regionName) {
    const ids = await aliasIds(db, "REGION", input.regionName);
    if (ids.length) {
      const regions = await db.adminRegion.findMany({
        where: { id: { in: ids }, countryIso2: result.countryIso2 },
        select: { id: true },
      });
      if (regions.length === 1) {
        result.regionId = regions[0]!.id;
        result.confidence = 0.7;
      }
    }
  }

  if (input.postalCode) {
    const postal = await db.postalArea.findUnique({
      where: { countryIso2_code: { countryIso2: result.countryIso2, code: input.postalCode.replace(/\s+/g, "") } },
      select: { cityId: true, regionId: true },
    });
    if (postal) {
      result.cityId = postal.cityId ?? result.cityId;
      result.regionId = postal.regionId ?? result.regionId;
      result.confidence = Math.max(result.confidence, 0.85);
    }
  }

  if (input.cityName && !result.cityId) {
    const ids = await aliasIds(db, "CITY", input.cityName);
    if (ids.length) {
      const cities = await db.city.findMany({
        where: {
          id: { in: ids },
          countryIso2: result.countryIso2,
          ...(result.regionId ? { regionId: result.regionId } : {}),
        },
        select: { id: true, regionId: true, latitude: true, longitude: true },
      });
      if (cities.length === 1) {
        const city = cities[0]!;
        result.cityId = city.id;
        result.regionId = result.regionId ?? city.regionId;
        result.latitude = result.latitude ?? city.latitude;
        result.longitude = result.longitude ?? city.longitude;
        result.confidence = 0.9;
      } else if (cities.length > 1) {
        result.resolution = "AMBIGUOUS";
        return result;
      }
    }
  }

  if (!result.cityId && result.latitude !== null && result.longitude !== null) {
    await nearestCity(db, result);
  }

  result.resolution = result.cityId || result.regionId ? "RESOLVED" : "UNRESOLVED";
  if (result.resolution === "UNRESOLVED" && result.countryIso2) result.resolution = "RESOLVED";
  return result;
}

async function nearestCity(db: Db, result: ResolvedLocation): Promise<void> {
  const rows = await db.$queryRaw<{ id: string; countryIso2: string; regionId: string | null; km: number }[]>`
    SELECT id, "countryIso2", "regionId",
           ST_Distance(geog, ST_SetSRID(ST_MakePoint(${result.longitude}, ${result.latitude}), 4326)::geography) / 1000 AS km
    FROM "City"
    WHERE ST_DWithin(geog, ST_SetSRID(ST_MakePoint(${result.longitude}, ${result.latitude}), 4326)::geography, ${NEAREST_CITY_MAX_KM * 1000})
    ORDER BY km ASC
    LIMIT 1`;
  const nearest = rows[0];
  if (!nearest) return;
  if (result.countryIso2 && nearest.countryIso2 !== result.countryIso2) return;
  result.countryIso2 = nearest.countryIso2;
  result.cityId = nearest.id;
  result.regionId = result.regionId ?? nearest.regionId;
  result.confidence = Math.max(result.confidence, 0.75);
  result.resolution = "RESOLVED";
}

// ---------------------------------------------------------------------------
// Project scope
// ---------------------------------------------------------------------------

export interface ScopeLocation {
  level: DiscoveryLocation["level"];
  continentCode: string | null;
  countryIso2: string | null;
  regionId: string | null;
  cityId: string | null;
  postalPrefix: string | null;
  latitude: number | null;
  longitude: number | null;
  radiusKm: number | null;
  includeNearby: boolean;
  /** Derived: for CITY, the city centroid; for REGION/CITY the owning country. */
  derivedCountry: string | null;
  derivedContinent: string | null;
  derivedLat: number | null;
  derivedLon: number | null;
  label: string;
}

export interface ProjectScope {
  worldwide: boolean;
  includes: ScopeLocation[];
  excludes: ScopeLocation[];
}

export async function loadProjectScope(db: Db, projectId: string): Promise<ProjectScope> {
  const project = await db.discoveryProject.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      geographicMode: true,
      locations: {
        include: {
          country: { select: { name: true, continentCode: true } },
          region: { select: { name: true, countryIso2: true, country: { select: { continentCode: true } } } },
          city: {
            select: {
              name: true,
              countryIso2: true,
              latitude: true,
              longitude: true,
              country: { select: { continentCode: true } },
            },
          },
        },
      },
    },
  });

  const toScope = (loc: (typeof project.locations)[number]): ScopeLocation => {
    const derivedCountry = loc.countryIso2 ?? loc.region?.countryIso2 ?? loc.city?.countryIso2 ?? null;
    const derivedContinent =
      loc.continentCode ??
      loc.country?.continentCode ??
      loc.region?.country.continentCode ??
      loc.city?.country.continentCode ??
      null;
    const label =
      loc.level === "CONTINENT"
        ? `Continent ${loc.continentCode}`
        : loc.level === "COUNTRY"
          ? (loc.country?.name ?? loc.countryIso2 ?? "?")
          : loc.level === "REGION"
            ? (loc.region?.name ?? "region")
            : loc.level === "CITY"
              ? `${loc.city?.name ?? "city"}${loc.includeNearby ? ` (+${NEARBY_KM} km)` : ""}`
              : loc.level === "POSTAL"
                ? `Postal ${loc.countryIso2} ${loc.postalPrefix}*`
                : `${loc.radiusKm} km around ${loc.latitude},${loc.longitude}`;
    return {
      level: loc.level,
      continentCode: loc.continentCode,
      countryIso2: loc.countryIso2,
      regionId: loc.regionId,
      cityId: loc.cityId,
      postalPrefix: loc.postalPrefix,
      latitude: loc.latitude,
      longitude: loc.longitude,
      radiusKm: loc.radiusKm,
      includeNearby: loc.includeNearby,
      derivedCountry,
      derivedContinent,
      derivedLat: loc.city?.latitude ?? loc.latitude,
      derivedLon: loc.city?.longitude ?? loc.longitude,
      label,
    };
  };

  const includes = project.locations.filter((l) => l.mode === "INCLUDE").map(toScope);
  const excludes = project.locations.filter((l) => l.mode === "EXCLUDE").map(toScope);
  return { worldwide: project.geographicMode === "WORLDWIDE" || includes.length === 0, includes, excludes };
}

function matchesOne(loc: ScopeLocation, place: ResolvedLocation): boolean | null {
  switch (loc.level) {
    case "CONTINENT":
      return place.continentCode ? place.continentCode === loc.continentCode : null;
    case "COUNTRY":
      return place.countryIso2 ? place.countryIso2 === loc.countryIso2 : null;
    case "REGION":
      if (place.regionId) return place.regionId === loc.regionId;
      return place.countryIso2 && place.countryIso2 !== loc.derivedCountry ? false : null;
    case "CITY": {
      if (place.cityId === loc.cityId) return true;
      if (
        loc.includeNearby &&
        place.latitude !== null &&
        place.longitude !== null &&
        loc.derivedLat !== null &&
        loc.derivedLon !== null
      ) {
        return haversineKm(place.latitude, place.longitude, loc.derivedLat, loc.derivedLon) <= NEARBY_KM;
      }
      if (place.cityId) return false;
      return place.countryIso2 && place.countryIso2 !== loc.derivedCountry ? false : null;
    }
    case "POSTAL":
      if (!place.postalCode) return place.countryIso2 && place.countryIso2 !== loc.countryIso2 ? false : null;
      return (
        place.countryIso2 === loc.countryIso2 &&
        place.postalCode.replace(/\s+/g, "").startsWith((loc.postalPrefix ?? "").replace(/\s+/g, ""))
      );
    case "POINT":
      if (place.latitude === null || place.longitude === null) return null;
      return (
        haversineKm(place.latitude, place.longitude, loc.latitude ?? 0, loc.longitude ?? 0) <= (loc.radiusKm ?? 0)
      );
    default:
      return null;
  }
}

/** true = in scope, false = out of scope, null = not enough location data to decide. */
export function inScope(scope: ProjectScope, place: ResolvedLocation): boolean | null {
  for (const loc of scope.excludes) {
    if (matchesOne(loc, place) === true) return false;
  }
  if (scope.worldwide) return true;
  let unknown = false;
  for (const loc of scope.includes) {
    const match = matchesOne(loc, place);
    if (match === true) return true;
    if (match === null) unknown = true;
  }
  return unknown ? null : false;
}

/** Countries an adapter should search, derived from the scope. Empty = no restriction. */
export async function scopeCountries(db: Db, scope: ProjectScope): Promise<string[]> {
  if (scope.worldwide) return [];
  const countries = new Set<string>();
  const continents: string[] = [];
  for (const loc of scope.includes) {
    if (loc.level === "CONTINENT" && loc.continentCode) continents.push(loc.continentCode);
    else if (loc.derivedCountry) countries.add(loc.derivedCountry);
  }
  if (continents.length) {
    const rows = await db.country.findMany({ where: { continentCode: { in: continents } }, select: { iso2: true } });
    rows.forEach((r) => countries.add(r.iso2));
  }
  return [...countries].sort();
}
