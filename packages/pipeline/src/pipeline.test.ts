/** Unit tests for pure pipeline logic (no database). */
import { describe, expect, it } from "vitest";
import { discoveryProjectSettings, hostFromUrl, normalizeCompanyName, normalizeRegistrationNumber, registrableDomain } from "@leadforge/shared";
import { inScope, type ProjectScope, type ResolvedLocation, type ScopeLocation } from "./geo";
import { naceCoverage, naceSection, normalizeNaceCode, industryAllowed } from "./taxonomy";
import { precheck } from "./normalize";
import { canTransition, requiresApproval } from "./projects";
import { checkDomain, providerCategory, summarize, type Resolver } from "./verify";
import { combine, companyScore } from "./scoring";

const place = (p: Partial<ResolvedLocation>): ResolvedLocation => ({
  countryIso2: null,
  continentCode: null,
  regionId: null,
  cityId: null,
  postalCode: null,
  latitude: null,
  longitude: null,
  resolution: "RESOLVED",
  confidence: 0.9,
  ...p,
});
const loc = (p: Partial<ScopeLocation>): ScopeLocation => ({
  level: "COUNTRY",
  continentCode: null,
  countryIso2: null,
  regionId: null,
  cityId: null,
  postalPrefix: null,
  latitude: null,
  longitude: null,
  radiusKm: null,
  includeNearby: false,
  derivedCountry: null,
  derivedContinent: null,
  derivedLat: null,
  derivedLon: null,
  label: "",
  ...p,
});

describe("names and domains", () => {
  it("strips legal forms only for comparison", () => {
    expect(normalizeCompanyName("Nordvind AB (publ)")).toBe("nordvind");
    expect(normalizeCompanyName("Kontor GmbH & Co. KG")).toBe("kontor");
    expect(normalizeCompanyName("Brightpath Ltd")).toBe("brightpath");
    expect(normalizeCompanyName("AB")).toBe("ab");
  });
  it("derives registrable domains with multi-part suffixes", () => {
    expect(registrableDomain("https://shop.example.co.uk/x")).toBe("example.co.uk");
    expect(registrableDomain("www.acme.se")).toBe("acme.se");
    expect(registrableDomain("localhost")).toBeNull();
    expect(hostFromUrl("not a url at all")).toBeNull();
  });
  it("normalizes registration numbers", () => {
    expect(normalizeRegistrationNumber("556123-4567")).toBe("5561234567");
    expect(normalizeRegistrationNumber("12")).toBeNull();
  });
});

describe("geography scope", () => {
  const goteborg = loc({ level: "CITY", cityId: "gbg", derivedCountry: "SE", derivedLat: 57.7089, derivedLon: 11.9746 });
  it("matches a city by stable id, not by name", () => {
    const scope: ProjectScope = { worldwide: false, includes: [goteborg], excludes: [] };
    expect(inScope(scope, place({ countryIso2: "SE", cityId: "gbg" }))).toBe(true);
    expect(inScope(scope, place({ countryIso2: "SE", cityId: "sthlm", latitude: 59.33, longitude: 18.07 }))).toBe(false);
    expect(inScope(scope, place({ countryIso2: "DE" }))).toBe(false);
    expect(inScope(scope, place({ countryIso2: "SE" }))).toBeNull();
  });
  it("includes nearby places only when opted in", () => {
    const molndal = place({ countryIso2: "SE", cityId: "molndal", latitude: 57.6554, longitude: 12.0138 });
    expect(inScope({ worldwide: false, includes: [goteborg], excludes: [] }, molndal)).toBe(false);
    expect(inScope({ worldwide: false, includes: [{ ...goteborg, includeNearby: true }], excludes: [] }, molndal)).toBe(true);
  });
  it("applies exclusions before inclusions", () => {
    const scope: ProjectScope = {
      worldwide: false,
      includes: [loc({ level: "COUNTRY", countryIso2: "SE" })],
      excludes: [loc({ level: "REGION", regionId: "skane", derivedCountry: "SE" })],
    };
    expect(inScope(scope, place({ countryIso2: "SE", regionId: "skane" }))).toBe(false);
    expect(inScope(scope, place({ countryIso2: "SE", regionId: "vg" }))).toBe(true);
  });
  it("supports continent, postal and radius scopes", () => {
    expect(inScope({ worldwide: false, includes: [loc({ level: "CONTINENT", continentCode: "EU" })], excludes: [] }, place({ continentCode: "EU" }))).toBe(true);
    const postal = loc({ level: "POSTAL", countryIso2: "SE", postalPrefix: "411" });
    expect(inScope({ worldwide: false, includes: [postal], excludes: [] }, place({ countryIso2: "SE", postalCode: "411 05" }))).toBe(true);
    expect(inScope({ worldwide: false, includes: [postal], excludes: [] }, place({ countryIso2: "SE", postalCode: "111 22" }))).toBe(false);
    const radius = loc({ level: "POINT", latitude: 59.33, longitude: 18.07, radiusKm: 40 });
    expect(inScope({ worldwide: false, includes: [radius], excludes: [] }, place({ latitude: 59.2, longitude: 17.63 }))).toBe(true);
  });
  it("treats an empty scope as worldwide", () => {
    expect(inScope({ worldwide: true, includes: [], excludes: [] }, place({}))).toBe(true);
  });
});

describe("taxonomy codes", () => {
  it("normalizes NACE/SNI codes", () => {
    expect(normalizeNaceCode("41200")).toBe("41.200");
    expect(normalizeNaceCode("F 41.20")).toBe("41.20");
    expect(normalizeNaceCode("C")).toBe("C");
    expect(naceSection("62.01")).toBe("J");
  });
  it("ranks more specific coverage higher", () => {
    expect(naceCoverage("F", "41.20")).toBe(1);
    expect(naceCoverage("41", "41.20")).toBeGreaterThan(naceCoverage("F", "41.20"));
    expect(naceCoverage("43.21", "43.21")).toBeGreaterThan(naceCoverage("43", "43.21"));
    expect(naceCoverage("43.21", "43.22")).toBe(-1);
    expect(naceCoverage("J62", "62.01")).toBeGreaterThan(0);
  });
  it("decides industry filters", () => {
    const scope = { include: new Set(["a"]), exclude: new Set(["x"]), naceCodes: [], aliasTerms: [] };
    const m = (id: string) => ({ industryId: id, code: id, confidence: 0.9, method: "SOURCE" as const, evidence: "" });
    expect(industryAllowed(scope, [m("a")])).toBe(true);
    expect(industryAllowed(scope, [m("b")])).toBe(false);
    expect(industryAllowed(scope, [m("a"), m("x")])).toBe(false);
    expect(industryAllowed(scope, [])).toBeNull();
  });
});

describe("normalization prechecks", () => {
  const ctx = (overrides: Record<string, unknown> = {}) => ({
    settings: discoveryProjectSettings.parse(overrides),
    includeKeywords: [] as string[],
    excludeKeywords: [] as string[],
  });
  const candidate = { name: "Bygg AB", website: "https://bygg.se", description: null, industryLabel: null, foundedYear: null, employeeRange: null, legalForm: null };
  it("requires a domain by default", () => {
    expect(precheck({ ...candidate, website: null }, ctx(), false)).toEqual({ ok: false, reason: "no_domain" });
    expect(precheck(candidate, ctx(), false)).toEqual({ ok: true, domain: "bygg.se" });
  });
  it("applies exclusions and keyword filters", () => {
    expect(precheck(candidate, ctx({ exclusions: { domains: ["www.bygg.se"] } }), false)).toEqual({ ok: false, reason: "excluded_domain" });
    expect(precheck(candidate, { ...ctx(), excludeKeywords: ["bygg"] }, false)).toEqual({ ok: false, reason: "excluded_keyword" });
    expect(precheck(candidate, { ...ctx(), includeKeywords: ["software"] }, false)).toEqual({ ok: false, reason: "keyword_mismatch" });
    expect(precheck(candidate, { ...ctx(), includeKeywords: ["software"] }, true).ok).toBe(true);
  });
  it("only filters on sourced facts", () => {
    const settings = { company: { foundedFrom: 2000, employeeRanges: ["10-49"] } };
    expect(precheck({ ...candidate, foundedYear: 1990 }, ctx(settings), false)).toEqual({ ok: false, reason: "founded_before_range" });
    expect(precheck({ ...candidate, employeeRange: "250-999" }, ctx(settings), false)).toEqual({ ok: false, reason: "employee_range_mismatch" });
    expect(precheck(candidate, ctx(settings), false).ok).toBe(true);
  });
});

describe("project lifecycle", () => {
  it("allows only legal transitions", () => {
    expect(canTransition("start", "READY")).toBe(true);
    expect(canTransition("start", "RUNNING")).toBe(false);
    expect(canTransition("pause", "RUNNING")).toBe(true);
    expect(canTransition("resume", "RUNNING")).toBe(false);
    expect(canTransition("cancel", "COMPLETED")).toBe(false);
  });
  it("requires approval for high-volume runs", () => {
    expect(requiresApproval({ maxCompanies: 500, geographicMode: "CITY" })).toBe(false);
    expect(requiresApproval({ maxCompanies: 50_000, geographicMode: "COUNTRY" })).toBe(true);
    expect(requiresApproval({ maxCompanies: 2_000, geographicMode: "WORLDWIDE" })).toBe(true);
  });
});

describe("verification", () => {
  const resolver = (mx: Resolver["resolveMx"], a: Resolver["resolve4"] = async () => []): Resolver => ({
    resolveMx: mx,
    resolve4: a,
    resolve6: async () => [],
  });
  const fail = (code: string) => async () => {
    throw Object.assign(new Error(code), { code });
  };
  it("keeps DNS and MX states separate", async () => {
    expect(await checkDomain("ok.test", resolver(async () => [{ exchange: "mx.ok.test", priority: 10 }]))).toMatchObject({ dnsStatus: "VALID", mxStatus: "VALID" });
    expect(await checkDomain("gone.test", resolver(fail("ENOTFOUND")))).toMatchObject({ dnsStatus: "NXDOMAIN", mxStatus: "MISSING" });
    expect(await checkDomain("a.test", resolver(fail("ENODATA"), async () => ["93.184.216.34"]))).toMatchObject({ dnsStatus: "VALID", mxStatus: "FALLBACK_A" });
    expect(await checkDomain("null.test", resolver(async () => [{ exchange: "", priority: 0 }]))).toMatchObject({ mxStatus: "MISSING" });
    expect(await checkDomain("flaky.test", resolver(fail("ESERVFAIL"), fail("ESERVFAIL")))).toMatchObject({ dnsStatus: "ERROR", mxStatus: "ERROR" });
  });
  it("summarizes without claiming mailbox existence", () => {
    expect(summarize({ syntaxValid: true, dnsStatus: "VALID", mxStatus: "VALID", category: "BUSINESS", suppressed: false })).toBe("MX_VALID");
    expect(summarize({ syntaxValid: true, dnsStatus: "VALID", mxStatus: "VALID", category: "BUSINESS", suppressed: true })).toBe("SUPPRESSED");
    expect(summarize({ syntaxValid: false, dnsStatus: "UNKNOWN", mxStatus: "UNKNOWN", category: "BUSINESS", suppressed: false })).toBe("UNDELIVERABLE");
    expect(summarize({ syntaxValid: true, dnsStatus: "ERROR", mxStatus: "ERROR", category: "BUSINESS", suppressed: false })).toBe("DELIVERABILITY_UNKNOWN");
    expect(summarize({ syntaxValid: true, dnsStatus: "VALID", mxStatus: "VALID", category: "DISPOSABLE", suppressed: false })).toBe("RISKY");
  });
  it("classifies providers", () => {
    expect(providerCategory("info", "acme.se")).toBe("ROLE_BASED");
    expect(providerCategory("anna", "gmail.com")).toBe("FREE_MAIL");
    expect(providerCategory("anna", "acme.se")).toBe("BUSINESS");
  });
});

describe("scoring", () => {
  it("is explainable and bounded", () => {
    const score = companyScore({
      hasOfficialWebsite: true,
      independentSources: 2,
      sourceType: "REGISTRY",
      locationConfidence: 0.9,
      industryConfidence: 0.9,
      observedAt: new Date(),
      reviewed: false,
    });
    expect(score.score).toBeGreaterThan(0.7);
    expect(score.score).toBeLessThanOrEqual(1);
    expect(score.components.map((c) => c.name)).toContain("corroboration");
    expect(combine([]).score).toBe(0);
  });
});
