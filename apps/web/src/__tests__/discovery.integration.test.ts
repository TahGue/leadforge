/**
 * Discovery pipeline integration tests (spec sections 5, 9, 16, 29) against a
 * real PostGIS database with reference data loaded. Route handlers are called
 * directly with real Request objects, as in api.integration.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { processPendingCandidates, resetTaxonomyCache } from "@leadforge/pipeline";
import * as login from "@/app/api/v1/auth/login/route";
import * as continents from "@/app/api/v1/geography/continents/route";
import * as countries from "@/app/api/v1/geography/countries/route";
import * as regions from "@/app/api/v1/geography/regions/route";
import * as cities from "@/app/api/v1/geography/cities/route";
import * as industries from "@/app/api/v1/industries/route";
import * as children from "@/app/api/v1/industries/[id]/children/route";
import * as projects from "@/app/api/v1/discovery-projects/route";
import * as project from "@/app/api/v1/discovery-projects/[id]/route";
import * as preview from "@/app/api/v1/discovery-projects/[id]/preview/route";
import * as start from "@/app/api/v1/discovery-projects/[id]/start/route";
import * as pause from "@/app/api/v1/discovery-projects/[id]/pause/route";
import * as resume from "@/app/api/v1/discovery-projects/[id]/resume/route";
import * as cancel from "@/app/api/v1/discovery-projects/[id]/cancel/route";
import * as approve from "@/app/api/v1/discovery-projects/[id]/approve/route";
import * as progress from "@/app/api/v1/discovery-projects/[id]/progress/route";
import * as results from "@/app/api/v1/discovery-projects/[id]/results/route";
import * as tags from "@/app/api/v1/companies/tags/route";
import * as companyEvidence from "@/app/api/v1/companies/[id]/evidence/route";
import * as contacts from "@/app/api/v1/contacts/route";
import * as exportCompanies from "@/app/api/v1/export/companies/route";
import * as jobRetry from "@/app/api/v1/jobs/[id]/retry/route";
import * as duplicates from "@/app/api/v1/duplicates/route";
import * as metrics from "@/app/api/v1/metrics/route";
import * as erase from "@/app/api/v1/data-requests/erase/route";
import * as campaigns from "@/app/api/v1/campaigns/route";
import * as sources from "@/app/api/v1/sources/[id]/route";

const BASE = "http://localhost:3000";
const stamp = Date.now();
let adminCookie = "";
let analystCookie = "";
let organizationId = "";
let userSourceId = "";
let unreviewedSourceId = "";
let gothenburgId = "";
let stockholmId = "";
let constructionId = "";

function req(path: string, init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { origin: BASE, ...(init.headers ?? {}) };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const cookie = init.cookie ?? adminCookie;
  if (cookie) headers.cookie = cookie;
  return new NextRequest(`${BASE}${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
async function body<T = any>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
async function signIn(email: string): Promise<string> {
  const response = await login.POST(req("/api/v1/auth/login", { body: { email, password: "ChangeMe123!" }, cookie: "" }));
  expect(response.status).toBe(200);
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

/** Stage records as the Python discovery worker would, then normalize them. */
async function stage(projectId: string, sourceId: string, rows: Record<string, unknown>[]) {
  await prisma.companyCandidate.createMany({
    data: rows.map((row, i) => ({
      organizationId,
      projectId,
      sourceId,
      sourceRecordId: `${stamp}-${projectId}-${i}`,
      name: String(row.name),
      ...row,
    })) as never,
  });
  await processPendingCandidates(500, projectId);
}

beforeAll(async () => {
  adminCookie = await signIn("admin@leadforge.local");
  analystCookie = await signIn("analyst@leadforge.local");
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@leadforge.local" }, include: { memberships: true } });
  organizationId = admin.memberships[0]!.organizationId;
  userSourceId = (await prisma.source.findFirstOrThrow({ where: { organizationId, adapter: "domain_list" } })).id;
  // Our own unreviewed source: the seeded OpenStreetMap source may have been approved by an operator.
  unreviewedSourceId = (
    await prisma.source.create({
      data: { organizationId, name: `Unreviewed directory ${stamp}`, sourceType: "DIRECTORY", adapter: "osm_overpass", policyStatus: "UNREVIEWED" },
    })
  ).id;
  gothenburgId = (await prisma.city.findUniqueOrThrow({ where: { externalId: "seed:SE:goteborg" } })).id;
  stockholmId = (await prisma.city.findUniqueOrThrow({ where: { externalId: "seed:SE:stockholm" } })).id;
  resetTaxonomyCache();
  const version = await prisma.industryTaxonomyVersion.findFirstOrThrow({ where: { isCurrent: true } });
  constructionId = (await prisma.industry.findUniqueOrThrow({ where: { versionId_code: { versionId: version.id, code: "construction" } } })).id;
}, 60_000);

afterAll(async () => {
  await prisma.discoveryProject.deleteMany({ where: { sources: { some: { sourceId: unreviewedSourceId } } } }).catch(() => undefined);
  await prisma.source.delete({ where: { id: unreviewedSourceId } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("geography and taxonomy APIs", () => {
  it("lists continents, countries, regions and country-scoped cities", async () => {
    const c = await body(await continents.GET(req("/api/v1/geography/continents"), ctx({})));
    expect(c.data.map((x: { code: string }) => x.code)).toContain("EU");
    const se = await body(await countries.GET(req("/api/v1/geography/countries?continent=EU&q=swe"), ctx({})));
    expect(se.data[0].iso2).toBe("SE");
    const r = await body(await regions.GET(req("/api/v1/geography/regions?country=SE"), ctx({})));
    expect(r.data.length).toBe(21);
    const found = await body(await cities.GET(req("/api/v1/geography/cities?country=SE&q=gothenburg"), ctx({})));
    expect(found.data.map((x: { id: string }) => x.id)).toContain(gothenburgId);
    const unscoped = await cities.GET(req("/api/v1/geography/cities?q=lund"), ctx({}));
    expect(unscoped.status).toBe(400);
  });

  it("serves the versioned industry tree with NACE codes", async () => {
    const tree = await body(await industries.GET(req("/api/v1/industries?tree=1"), ctx({})));
    expect(tree.version.taxonomy).toBe("LEADFORGE");
    const construction = tree.data.find((s: { code: string }) => s.code === "construction");
    expect(construction.children.length).toBeGreaterThan(3);
    const kids = await body(await children.GET(req(`/api/v1/industries/${constructionId}/children`), ctx({ id: constructionId })));
    expect(kids.data.some((k: { externalCodes: { code: string }[] }) => k.externalCodes.some((e) => e.code === "41"))).toBe(true);
  });
});

describe("discovery project lifecycle", () => {
  let projectId = "";

  it("validates the wizard payload", async () => {
    const bad = await projects.POST(
      req("/api/v1/discovery-projects", { body: { name: "Bad", locations: [{ level: "CITY", mode: "INCLUDE" }] } }),
      ctx({}),
    );
    expect(bad.status).toBe(400);
    const unknownCity = await projects.POST(
      req("/api/v1/discovery-projects", { body: { name: "Bad", locations: [{ level: "CITY", cityId: "nope" }] } }),
      ctx({}),
    );
    expect(unknownCity.status).toBe(400);
  });

  it("creates a project with geography, industry, keywords, sources and settings", async () => {
    const response = await projects.POST(
      req("/api/v1/discovery-projects", {
        body: {
          name: `Construction in Gothenburg ${stamp}`,
          geographicMode: "CITY",
          maxCompanies: 50,
          locations: [{ level: "CITY", cityId: gothenburgId, countryIso2: "SE", includeNearby: true }],
          industries: [{ industryId: constructionId }],
          keywords: [{ keyword: "demolition", mode: "EXCLUDE" }],
          sources: [{ sourceId: userSourceId, configuration: { domains: ["bygg-a.example"] } }],
          settings: { contacts: { categories: ["GENERAL", "SALES"] } },
        },
        cookie: analystCookie,
      }),
      ctx({}),
    );
    expect(response.status).toBe(201);
    projectId = (await body(response)).data.id;
    const detail = await body(await project.GET(req(`/api/v1/discovery-projects/${projectId}`), ctx({ id: projectId })));
    expect(detail.data.locations[0].city.name).toBe("Göteborg");
    expect(detail.data.industries[0].industryId).toBe(constructionId);
    expect(detail.data.settings.crawl.requestsPerDomainPerMinute).toBe(6);
    expect(detail.data.status).toBe("READY");
  });

  it("previews scope, budget and policy warnings", async () => {
    const response = await preview.POST(req(`/api/v1/discovery-projects/${projectId}/preview`, { body: {} }), ctx({ id: projectId }));
    const data = (await body(response)).data;
    expect(data.blockers).toEqual([]);
    expect(data.scope.geography[0]).toContain("Göteborg");
    expect(data.budget.maxRequests).toBe(50 * 12);
    expect(data.sources[0].usable).toBe(true);
  });

  it("refuses to start with only an unreviewed source", async () => {
    const other = await projects.POST(
      req("/api/v1/discovery-projects", { body: { name: `Unreviewed ${stamp}`, sources: [{ sourceId: unreviewedSourceId }] } }),
      ctx({}),
    );
    const id = (await body(other)).data.id;
    const p = (await body(await preview.POST(req(`/api/v1/discovery-projects/${id}/preview`, { body: {} }), ctx({ id })))).data;
    expect(p.blockers.join(" ")).toMatch(/approved/);
    const response = await start.POST(req(`/api/v1/discovery-projects/${id}/start`, { body: {} }), ctx({ id }));
    expect(response.status).toBe(409);
  });

  it("requires a person to approve a high-volume project", async () => {
    const big = await projects.POST(
      req("/api/v1/discovery-projects", {
        body: { name: `Big ${stamp}`, maxCompanies: 20000, sources: [{ sourceId: userSourceId, configuration: { domains: ["x.example"] } }] },
      }),
      ctx({}),
    );
    const id = (await body(big)).data.id;
    expect((await start.POST(req(`/api/v1/discovery-projects/${id}/start`, { body: {} }), ctx({ id }))).status).toBe(409);
    expect((await approve.POST(req(`/api/v1/discovery-projects/${id}/approve`, { body: {}, cookie: analystCookie }), ctx({ id }))).status).toBe(403);
    expect((await approve.POST(req(`/api/v1/discovery-projects/${id}/approve`, { body: {} }), ctx({ id }))).status).toBe(200);
    expect((await start.POST(req(`/api/v1/discovery-projects/${id}/start`, { body: {} }), ctx({ id }))).status).toBe(202);
    await cancel.POST(req(`/api/v1/discovery-projects/${id}/cancel`, { body: {} }), ctx({ id }));
  });

  it("starts: one discovery run per approved source", async () => {
    const response = await start.POST(req(`/api/v1/discovery-projects/${projectId}/start`, { body: {} }), ctx({ id: projectId }));
    expect(response.status).toBe(202);
    const runs = await prisma.discoveryRun.findMany({ where: { projectId } });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("QUEUED");
    expect(runs[0]!.query).toEqual({ domains: ["bygg-a.example"] });
    const again = await start.POST(req(`/api/v1/discovery-projects/${projectId}/start`, { body: {} }), ctx({ id: projectId }));
    expect(again.status).toBe(409);
  });

  it("normalizes source records: geography, taxonomy, dedup, provenance, crawl jobs", async () => {
    await stage(projectId, userSourceId, [
      { name: `Bygg Väst AB ${stamp}`, website: `https://bygg-vast-${stamp}.se`, countryIso2: "SE", cityName: "Göteborg", industryCodes: [{ scheme: "SNI", code: "41200" }], registrationNumber: `556${String(stamp).slice(-7)}` },
      { name: `Mölndal Bygg AB ${stamp}`, website: `https://molndal-${stamp}.se`, countryIso2: "SE", cityName: "Mölndal", industryLabel: "Byggföretag" },
      { name: `Stockholm Bygg AB ${stamp}`, website: `https://sthlm-${stamp}.se`, countryIso2: "SE", cityName: "Stockholm", industryCodes: [{ scheme: "NACE", code: "41.20" }] },
      { name: `Kod AB ${stamp}`, website: `https://kod-${stamp}.se`, countryIso2: "SE", cityName: "Göteborg", industryCodes: [{ scheme: "NACE", code: "62.01" }] },
      { name: `Rivning AB ${stamp}`, website: `https://rivning-${stamp}.se`, countryIso2: "SE", cityName: "Göteborg", description: "Demolition specialists", industryCodes: [{ scheme: "NACE", code: "43.11" }] },
      { name: `Ingen Webb AB ${stamp}`, countryIso2: "SE", cityName: "Göteborg" },
      { name: `Bygg Väst Duplicate ${stamp}`, website: `https://www.bygg-vast-${stamp}.se/kontakt`, countryIso2: "SE", cityName: "Göteborg" },
    ]);
    const staged = await prisma.companyCandidate.findMany({ where: { projectId }, orderBy: { sourceRecordId: "asc" } });
    const outcome = Object.fromEntries(staged.map((s) => [s.name.replace(` ${stamp}`, ""), s.rejectReason ?? s.status]));
    expect(outcome["Bygg Väst AB"]).toBe("CREATED");
    expect(outcome["Mölndal Bygg AB"]).toBe("CREATED"); // nearby Göteborg, opted in
    expect(outcome["Stockholm Bygg AB"]).toBe("outside_geography");
    expect(outcome["Kod AB"]).toBe("industry_mismatch");
    expect(outcome["Rivning AB"]).toBe("excluded_keyword");
    expect(outcome["Ingen Webb AB"]).toBe("no_domain");
    expect(outcome["Bygg Väst Duplicate"]).toBe("MERGED"); // same registrable domain

    const company = await prisma.company.findFirstOrThrow({
      where: { organizationId, name: `Bygg Väst AB ${stamp}` },
      include: { locations: true, industries: { include: { industry: true } }, observations: true, crawlJobs: true, domains: { include: { domain: true } } },
    });
    expect(company.locations[0]!.cityId).toBe(gothenburgId);
    expect(company.locations[0]!.resolution).toBe("RESOLVED");
    expect(company.industries[0]!.industry.code).toBe("construction.buildings");
    expect(company.industries[0]!.method).toBe("SOURCE");
    expect(company.observations.some((o) => o.fieldName === "registration_number")).toBe(true);
    const source = await prisma.source.findUniqueOrThrow({ where: { id: userSourceId } });
    expect(company.observations.every((o) => o.policyVersion === source.policyVersion)).toBe(true);
    expect(company.domains[0]!.domain.domain).toBe(`bygg-vast-${stamp}.se`);
    expect(company.crawlJobs).toHaveLength(1);
    expect(company.confidenceDetail).toHaveProperty("components");

    const evidence = await body(await companyEvidence.GET(req(`/api/v1/companies/${company.id}/evidence`), ctx({ id: company.id })));
    expect(evidence.data.observations.length).toBeGreaterThan(3);

    const p = (await body(await progress.GET(req(`/api/v1/discovery-projects/${projectId}/progress`), ctx({ id: projectId })))).data;
    expect(p.companies).toBe(2);
    expect(p.rejectReasons.outside_geography).toBe(1);
    expect(p.crawls.QUEUED).toBe(2);
  });

  it("pauses, resumes and cancels; refuses illegal transitions", async () => {
    expect((await pause.POST(req(`/api/v1/discovery-projects/${projectId}/pause`, { body: {} }), ctx({ id: projectId }))).status).toBe(202);
    expect((await pause.POST(req(`/api/v1/discovery-projects/${projectId}/pause`, { body: {} }), ctx({ id: projectId }))).status).toBe(409);
    const edit = await project.PATCH(req(`/api/v1/discovery-projects/${projectId}`, { method: "PATCH", body: { maxCompanies: 60 } }), ctx({ id: projectId }));
    expect(edit.status).toBe(200);
    expect((await resume.POST(req(`/api/v1/discovery-projects/${projectId}/resume`, { body: {} }), ctx({ id: projectId }))).status).toBe(202);
    const running = await project.PATCH(req(`/api/v1/discovery-projects/${projectId}`, { method: "PATCH", body: { maxCompanies: 70 } }), ctx({ id: projectId }));
    expect(running.status).toBe(409);
    expect((await cancel.POST(req(`/api/v1/discovery-projects/${projectId}/cancel`, { body: {} }), ctx({ id: projectId }))).status).toBe(202);
    const jobs = await prisma.crawlJob.findMany({ where: { projectId } });
    expect(jobs.every((j) => j.status === "CANCELLED")).toBe(true);
  });

  it("serves results, with a strict view for post-crawl filters", async () => {
    const all = await body(await results.GET(req(`/api/v1/discovery-projects/${projectId}/results`), ctx({ id: projectId })));
    expect(all.data).toHaveLength(2);
    const strict = await body(await results.GET(req(`/api/v1/discovery-projects/${projectId}/results?strict=1`), ctx({ id: projectId })));
    expect(strict.data).toHaveLength(0); // no contacts crawled yet
  });
});

describe("data operations", () => {
  it("tags companies in bulk", async () => {
    const company = await prisma.company.findFirstOrThrow({ where: { organizationId, name: `Bygg Väst AB ${stamp}` } });
    const response = await tags.POST(req("/api/v1/companies/tags", { body: { ids: [company.id], add: ["Customer"] } }), ctx({}));
    expect(response.status).toBe(200);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: company.id } })).tags).toContain("customer");
  });

  it("exports companies as CSV with provenance columns", async () => {
    const response = await exportCompanies.GET(req(`/api/v1/export/companies?q=${encodeURIComponent(`Bygg Väst AB ${stamp}`)}`), ctx({}));
    expect(response.headers.get("content-type")).toContain("text/csv");
    const text = await response.text();
    expect(text.split("\n")[0]).toContain("evidence_count");
    expect(text).toContain(`Bygg Väst AB ${stamp}`);
  });

  it("requires a source URL for manual contacts and refuses suppressed addresses", async () => {
    const company = await prisma.company.findFirstOrThrow({ where: { organizationId, name: `Bygg Väst AB ${stamp}` } });
    const noSource = await contacts.POST(req("/api/v1/contacts", { body: { companyId: company.id, email: "a@b.se" } }), ctx({}));
    expect(noSource.status).toBe(400);
    await prisma.suppressionEntry.create({
      data: { organizationId, emailNormalized: `blocked-${stamp}@example.se`, reason: "MANUAL" },
    });
    const suppressed = await contacts.POST(
      req("/api/v1/contacts", { body: { companyId: company.id, email: `blocked-${stamp}@example.se`, sourceUrl: "https://example.se/kontakt" } }),
      ctx({}),
    );
    expect(suppressed.status).toBe(409);
    const ok = await contacts.POST(
      req("/api/v1/contacts", {
        body: { companyId: company.id, email: `sales-${stamp}@example.se`, category: "SALES", sourceUrl: "https://example.se/kontakt" },
      }),
      ctx({}),
    );
    expect(ok.status).toBe(201);
  });

  it("never lets an analyst re-queue a policy-blocked crawl", async () => {
    const job = await prisma.crawlJob.findFirstOrThrow({ where: { organizationId, project: { name: `Construction in Gothenburg ${stamp}` } } });
    await prisma.crawlJob.update({ where: { id: job.id }, data: { status: "BLOCKED", policyStopReason: "http_403" } });
    expect((await jobRetry.POST(req(`/api/v1/jobs/${job.id}/retry`, { body: {}, cookie: analystCookie }), ctx({ id: job.id }))).status).toBe(403);
    expect((await jobRetry.POST(req(`/api/v1/jobs/${job.id}/retry`, { body: {} }), ctx({ id: job.id }))).status).toBe(202);
    expect((await prisma.crawlJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("QUEUED");
  });

  it("reopens a failed project when one of its jobs is retried", async () => {
    const job = await prisma.crawlJob.findFirstOrThrow({ where: { organizationId, project: { name: `Construction in Gothenburg ${stamp}` } } });
    await prisma.crawlJob.update({ where: { id: job.id }, data: { status: "FAILED", errorCode: "transient_exhausted" } });
    await prisma.discoveryProject.update({ where: { id: job.projectId! }, data: { status: "FAILED", lastError: "overpass server error", finishedAt: new Date() } });
    expect((await jobRetry.POST(req(`/api/v1/jobs/${job.id}/retry`, { body: {}, cookie: analystCookie }), ctx({ id: job.id }))).status).toBe(202);
    const project = await prisma.discoveryProject.findUniqueOrThrow({ where: { id: job.projectId! } });
    expect(project.status).toBe("RUNNING");
    expect(project.lastError).toBeNull();
    expect(project.finishedAt).toBeNull();
  });

  it("flags lookalike names for human review instead of merging", async () => {
    const pair = await prisma.company.findMany({ where: { organizationId, normalizedName: `lookalike ${stamp}` } });
    expect(pair).toHaveLength(0);
    for (const site of ["one", "two"]) {
      await prisma.company.create({
        data: { organizationId, name: `Lookalike ${stamp} AB`, normalizedName: `lookalike ${stamp}`, countryCode: "SE", website: `https://${site}.example` },
      });
    }
    const response = await duplicates.POST(req("/api/v1/duplicates", { body: {} }), ctx({}));
    expect((await body(response)).data.added).toBeGreaterThanOrEqual(1);
    const listed = await body(await duplicates.GET(req("/api/v1/duplicates"), ctx({})));
    expect(listed.data.some((d: { companyA: { name: string } }) => d.companyA.name === `Lookalike ${stamp} AB`)).toBe(true);
  });

  it("erases a person's data and keeps them suppressed", async () => {
    const response = await erase.POST(req("/api/v1/data-requests/erase", { body: { email: `sales-${stamp}@example.se` } }), ctx({}));
    expect(response.status).toBe(200);
    const suppression = await prisma.suppressionEntry.findFirst({ where: { emailNormalized: `sales-${stamp}@example.se`, reason: "LEGAL_OBJECTION" } });
    expect(suppression).not.toBeNull();
    const evidence = await prisma.sourceEvidence.count({ where: { extractedValue: `sales-${stamp}@example.se` } });
    expect(evidence).toBe(0);
  });
});

describe("governance", () => {
  it("requires terms, permitted use and automated-access confirmation to approve a source", async () => {
    const refused = await sources.PATCH(
      req(`/api/v1/sources/${unreviewedSourceId}`, { method: "PATCH", body: { policyStatus: "APPROVED" } }),
      ctx({ id: unreviewedSourceId }),
    );
    expect(refused.status).toBe(400);
    const byAnalyst = await sources.PATCH(
      req(`/api/v1/sources/${unreviewedSourceId}`, { method: "PATCH", body: { policyNotes: "x" }, cookie: analystCookie }),
      ctx({ id: unreviewedSourceId }),
    );
    expect(byAnalyst.status).toBe(403);
  });

  it("keeps metrics private", async () => {
    delete process.env.METRICS_TOKEN;
    expect((await metrics.GET(req("/api/v1/metrics"))).status).toBe(404);
    process.env.METRICS_TOKEN = "metrics-test-token";
    expect((await metrics.GET(req("/api/v1/metrics", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    const ok = await metrics.GET(req("/api/v1/metrics", { headers: { authorization: "Bearer metrics-test-token" } }));
    expect(ok.status).toBe(200);
    const text = await ok.text();
    expect(text).toContain("leadforge_companies");
    expect(text).toContain("leadforge_crawl_jobs");
  });

  it("hides campaign endpoints while campaigns are frozen", async () => {
    process.env.FEATURE_CAMPAIGNS = "false";
    try {
      expect((await campaigns.GET(req("/api/v1/campaigns"), ctx({}))).status).toBe(404);
    } finally {
      process.env.FEATURE_CAMPAIGNS = "true";
    }
    expect((await campaigns.GET(req("/api/v1/campaigns"), ctx({}))).status).toBe(200);
  });
});
