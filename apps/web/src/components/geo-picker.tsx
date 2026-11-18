"use client";

/**
 * Location picker (spec 5.1): continent -> country -> region -> city -> postal
 * prefix, or a radius around a point. Selections always carry stable IDs; city
 * search is scoped to a country because city names repeat across countries.
 */
import { useEffect, useState } from "react";
import type { DiscoveryLocationInput } from "@leadforge/shared";
import { api } from "@/lib/client";

export type LocationValue = DiscoveryLocationInput & { label: string };

export interface GeoOptions {
  continents: { code: string; name: string }[];
  countries: { iso2: string; name: string; continentCode: string }[];
}

type Level = DiscoveryLocationInput["level"];

interface Region {
  id: string;
  name: string;
}
interface City {
  id: string;
  name: string;
  region: { name: string } | null;
  latitude: number;
  longitude: number;
}

export function GeoPicker({
  options,
  value,
  onChange,
}: {
  options: GeoOptions;
  value: LocationValue[];
  onChange: (next: LocationValue[]) => void;
}) {
  const [mode, setMode] = useState<"INCLUDE" | "EXCLUDE">("INCLUDE");
  const [level, setLevel] = useState<Level>("COUNTRY");
  const [continent, setContinent] = useState("EU");
  const [country, setCountry] = useState("SE");
  const [regions, setRegions] = useState<Region[]>([]);
  const [region, setRegion] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [cities, setCities] = useState<City[]>([]);
  const [city, setCity] = useState("");
  const [nearby, setNearby] = useState(false);
  const [postal, setPostal] = useState("");
  const [point, setPoint] = useState({ lat: "", lon: "", radius: "25" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!["REGION", "CITY"].includes(level) || !country) return;
    api<Region[]>(`/api/v1/geography/regions?country=${country}`)
      .then(setRegions)
      .catch(() => setRegions([]));
  }, [level, country]);

  useEffect(() => {
    if (level !== "CITY" || !country) return;
    const handle = setTimeout(() => {
      const params = new URLSearchParams({ country, limit: "50" });
      if (region) params.set("regionId", region);
      if (cityQuery.trim()) params.set("q", cityQuery.trim());
      api<City[]>(`/api/v1/geography/cities?${params}`)
        .then(setCities)
        .catch(() => setCities([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [level, country, region, cityQuery]);

  const countryName = (iso: string) => options.countries.find((c) => c.iso2 === iso)?.name ?? iso;

  function add() {
    setError(null);
    let loc: LocationValue | null = null;
    const base = { mode, includeNearby: false };
    if (level === "CONTINENT") {
      loc = { ...base, level, continentCode: continent, label: options.continents.find((c) => c.code === continent)?.name ?? continent };
    } else if (level === "COUNTRY") {
      loc = { ...base, level, countryIso2: country, label: countryName(country) };
    } else if (level === "REGION") {
      const r = regions.find((x) => x.id === region);
      if (!r) return setError("Choose a region");
      loc = { ...base, level, regionId: r.id, countryIso2: country, label: `${r.name}, ${countryName(country)}` };
    } else if (level === "CITY") {
      const c = cities.find((x) => x.id === city);
      if (!c) return setError("Choose a city");
      loc = {
        ...base,
        level,
        cityId: c.id,
        countryIso2: country,
        includeNearby: nearby,
        label: `${c.name}, ${countryName(country)}${nearby ? " (+ nearby)" : ""}`,
      };
    } else if (level === "POSTAL") {
      if (!postal.trim()) return setError("Enter a postal code or prefix");
      loc = { ...base, level, countryIso2: country, postalPrefix: postal.trim(), label: `${countryName(country)} postal ${postal.trim()}*` };
    } else {
      const lat = Number(point.lat);
      const lon = Number(point.lon);
      const radius = Number(point.radius);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !(radius > 0)) return setError("Enter latitude, longitude and radius");
      loc = { ...base, level, latitude: lat, longitude: lon, radiusKm: radius, label: `${radius} km around ${lat.toFixed(3)}, ${lon.toFixed(3)}` };
    }
    const key = (l: LocationValue) => `${l.mode}|${l.level}|${l.continentCode}|${l.countryIso2}|${l.regionId}|${l.cityId}|${l.postalPrefix}|${l.latitude}|${l.longitude}`;
    if (value.some((v) => key(v) === key(loc!))) return setError("Already added");
    onChange([...value, loc]);
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs">
          <span className="muted">Include or exclude</span>
          <select className="input mt-1" value={mode} onChange={(e) => setMode(e.target.value as "INCLUDE" | "EXCLUDE")}>
            <option value="INCLUDE">Include</option>
            <option value="EXCLUDE">Exclude</option>
          </select>
        </label>
        <label className="text-xs">
          <span className="muted">Level</span>
          <select className="input mt-1" value={level} onChange={(e) => setLevel(e.target.value as Level)}>
            <option value="CONTINENT">Continent</option>
            <option value="COUNTRY">Country</option>
            <option value="REGION">Region / state</option>
            <option value="CITY">City</option>
            <option value="POSTAL">Postal code prefix</option>
            <option value="POINT">Radius around a point</option>
          </select>
        </label>
        {level === "CONTINENT" ? (
          <label className="text-xs">
            <span className="muted">Continent</span>
            <select className="input mt-1" value={continent} onChange={(e) => setContinent(e.target.value)}>
              {options.continents.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : level !== "POINT" ? (
          <label className="text-xs">
            <span className="muted">Country</span>
            <select
              className="input mt-1"
              value={country}
              onChange={(e) => {
                setCountry(e.target.value);
                setRegion("");
                setCity("");
              }}
            >
              {options.countries.map((c) => (
                <option key={c.iso2} value={c.iso2}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {level === "REGION" || level === "CITY" ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-xs">
            <span className="muted">Region{level === "CITY" ? " (optional filter)" : ""}</span>
            <select className="input mt-1" value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="">{regions.length ? "—" : "No regions imported for this country"}</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          {level === "CITY" ? (
            <>
              <label className="text-xs">
                <span className="muted">Search city</span>
                <input className="input mt-1" value={cityQuery} onChange={(e) => setCityQuery(e.target.value)} placeholder="e.g. Göteborg" />
              </label>
              <label className="text-xs">
                <span className="muted">City</span>
                <select className="input mt-1" value={city} onChange={(e) => setCity(e.target.value)}>
                  <option value="">{cities.length ? "Choose…" : "No match"}</option>
                  {cities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.region ? ` — ${c.region.name}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs sm:col-span-3">
                <input type="checkbox" checked={nearby} onChange={(e) => setNearby(e.target.checked)} />
                Include nearby places (within 25 km). Off by default.
              </label>
            </>
          ) : null}
        </div>
      ) : null}

      {level === "POSTAL" ? (
        <input className="input" value={postal} onChange={(e) => setPostal(e.target.value)} placeholder="Postal code or prefix, e.g. 411" />
      ) : null}

      {level === "POINT" ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <input className="input" value={point.lat} onChange={(e) => setPoint({ ...point, lat: e.target.value })} placeholder="Latitude" />
          <input className="input" value={point.lon} onChange={(e) => setPoint({ ...point, lon: e.target.value })} placeholder="Longitude" />
          <input className="input" value={point.radius} onChange={(e) => setPoint({ ...point, radius: e.target.value })} placeholder="Radius km" />
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button type="button" className="btn" onClick={add}>
          Add location
        </button>
        {error ? <span className="text-xs text-red-700">{error}</span> : null}
      </div>

      {value.length ? (
        <ul className="flex flex-wrap gap-2">
          {value.map((loc, index) => (
            <li
              key={`${loc.label}-${index}`}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${loc.mode === "EXCLUDE" ? "border-red-300 bg-red-50" : "border-[var(--lf-line)] bg-white"}`}
            >
              <span className="font-medium">{loc.mode === "EXCLUDE" ? "Exclude" : loc.level.toLowerCase()}</span>
              {loc.label}
              <button type="button" aria-label={`Remove ${loc.label}`} onClick={() => onChange(value.filter((_, i) => i !== index))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs muted">No locations: the project is worldwide unless you choose a geographic mode with locations.</p>
      )}
    </div>
  );
}
