"use client";

/**
 * Market Explorer (spec 21): map + geography browser + industry tree over the
 * companies already in LeadForge, and "create a discovery project from this
 * selection".
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MapView, type MapPoint } from "./map-view";

export interface ExplorerCity {
  id: string;
  name: string;
  countryIso2: string;
  regionName: string | null;
  latitude: number;
  longitude: number;
  companies: number;
}

export interface ExplorerCountry {
  iso2: string;
  name: string;
  continentCode: string;
  companies: number;
}

export interface ExplorerIndustry {
  id: string;
  name: string;
  companies: number;
  children: { id: string; name: string; companies: number }[];
}

export function Explorer({
  continents,
  countries,
  cities,
  industries,
}: {
  continents: { code: string; name: string }[];
  countries: ExplorerCountry[];
  cities: ExplorerCity[];
  industries: ExplorerIndustry[];
}) {
  const router = useRouter();
  const [continent, setContinent] = useState<string>("");
  const [country, setCountry] = useState<string>("");
  const [city, setCity] = useState<string>("");
  const [industry, setIndustry] = useState<string>("");
  const [view, setView] = useState<"map" | "list">("map");

  const visibleCountries = countries.filter((c) => !continent || c.continentCode === continent);
  const visibleCities = cities.filter((c) => (!country || c.countryIso2 === country) && (!continent || countries.find((x) => x.iso2 === c.countryIso2)?.continentCode === continent));
  const points: MapPoint[] = useMemo(
    () => visibleCities.map((c) => ({ id: c.id, name: `${c.name} (${c.companies})`, latitude: c.latitude, longitude: c.longitude, count: c.companies })),
    [visibleCities],
  );

  function resultsHref(): string {
    const params = new URLSearchParams();
    if (country) params.set("country", country);
    if (city) params.set("cityId", city);
    if (industry) params.set("industryId", industry);
    return `/companies?${params}`;
  }

  function createProject() {
    const params = new URLSearchParams();
    if (continent) params.set("continent", continent);
    if (country) params.set("country", country);
    if (city) params.set("city", city);
    if (industry) params.set("industry", industry);
    router.push(`/projects/new?${params}`);
  }

  const total = visibleCities.reduce((n, c) => n + c.companies, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <aside className="space-y-4">
        <div className="card space-y-2 p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide muted">Geography</p>
          <select className="input" value={continent} onChange={(e) => { setContinent(e.target.value); setCountry(""); setCity(""); }}>
            <option value="">All continents</option>
            {continents.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>
          <select className="input" value={country} onChange={(e) => { setCountry(e.target.value); setCity(""); }}>
            <option value="">All countries</option>
            {visibleCountries.map((c) => (
              <option key={c.iso2} value={c.iso2}>
                {c.name}{c.companies ? ` (${c.companies})` : ""}
              </option>
            ))}
          </select>
          <select className="input" value={city} onChange={(e) => setCity(e.target.value)} disabled={!country}>
            <option value="">{country ? "All cities" : "Choose a country first"}</option>
            {visibleCities.filter((c) => c.countryIso2 === country).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.companies ? ` (${c.companies})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="card space-y-1 p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide muted">Industry</p>
          <button type="button" className={`block w-full rounded px-2 py-1 text-left ${industry === "" ? "bg-[#eef2ff]" : ""}`} onClick={() => setIndustry("")}>
            All industries
          </button>
          <div className="max-h-80 overflow-y-auto">
            {industries.map((sector) => (
              <div key={sector.id}>
                <button type="button" className={`block w-full rounded px-2 py-1 text-left ${industry === sector.id ? "bg-[#eef2ff]" : ""}`} onClick={() => setIndustry(sector.id)}>
                  {sector.name} <span className="text-xs muted">{sector.companies || ""}</span>
                </button>
                {industry === sector.id || sector.children.some((c) => c.id === industry)
                  ? sector.children.map((child) => (
                      <button key={child.id} type="button" className={`block w-full rounded px-2 py-0.5 pl-6 text-left text-xs ${industry === child.id ? "bg-[#eef2ff]" : ""}`} onClick={() => setIndustry(child.id)}>
                        {child.name} <span className="muted">{child.companies || ""}</span>
                      </button>
                    ))
                  : null}
              </div>
            ))}
          </div>
        </div>
        <button type="button" className="btn btn-primary w-full justify-center" onClick={createProject}>
          Create discovery project from this selection
        </button>
      </aside>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">
            <span className="font-semibold">{total.toLocaleString("en")}</span> companies with a resolved location in this view
          </p>
          <div className="flex gap-1">
            <button type="button" className={`btn text-xs ${view === "map" ? "btn-primary" : ""}`} onClick={() => setView("map")}>Map</button>
            <button type="button" className={`btn text-xs ${view === "list" ? "btn-primary" : ""}`} onClick={() => setView("list")}>List</button>
            <a className="btn text-xs" href={resultsHref()}>Open results</a>
          </div>
        </div>
        {view === "map" ? (
          <MapView points={points.filter((p) => (p.count ?? 0) > 0)} height={480} onSelect={(p) => router.push(`/companies?cityId=${p.id}${industry ? `&industryId=${industry}` : ""}`)} />
        ) : (
          <div className="card overflow-hidden">
            <table className="table">
              <thead>
                <tr><th>City</th><th>Region</th><th>Country</th><th>Companies</th></tr>
              </thead>
              <tbody>
                {visibleCities.filter((c) => c.companies > 0).sort((a, b) => b.companies - a.companies).map((c) => (
                  <tr key={c.id}>
                    <td><a className="hover:underline" href={`/companies?cityId=${c.id}`}>{c.name}</a></td>
                    <td className="text-xs muted">{c.regionName ?? "—"}</td>
                    <td>{c.countryIso2}</td>
                    <td className="tabular-nums">{c.companies}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs muted">
          Map tiles: {process.env.NEXT_PUBLIC_MAP_STYLE_URL ? "operator-configured style" : "none configured (set NEXT_PUBLIC_MAP_STYLE_URL to a permitted or self-hosted tile style)"}. Geography © ISO 3166; GeoNames data CC BY 4.0 where imported.
        </p>
      </section>
    </div>
  );
}
