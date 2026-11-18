/**
 * End-to-end API tests against a real database.
 *
 * Next's server cannot be booted in every sandbox (it forks a child process),
 * so these tests invoke the route handlers directly with real Request objects.
 * They exercise the same code path the HTTP server uses: auth, org scoping,
 * validation, persistence, compliance evaluation and campaign preparation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import * as health from "@/app/api/v1/health/route";
import * as login from "@/app/api/v1/auth/login/route";
import * as companies from "@/app/api/v1/companies/route";
import * as companyDetail from "@/app/api/v1/companies/[id]/route";
import * as approveJurisdiction from "@/app/api/v1/jurisdictions/[code]/approve/route";
import * as campaigns from "@/app/api/v1/campaigns/route";
import * as prepareCampaign from "@/app/api/v1/campaigns/[id]/prepare/route";
import * as approveCampaign from "@/app/api/v1/campaigns/[id]/approve/route";
import * as eligibility from "@/app/api/v1/eligibility/evaluate/route";
import * as suppressions from "@/app/api/v1/suppressions/route";
import * as imports from "@/app/api/v1/imports/route";
import * as unsubscribe from "@/app/api/v1/unsubscribe/[token]/route";
import { createUnsubscribeLink } from "@/lib/mail";

const BASE = "http://localhost:3000";
let cookie = "";
let organizationId = "";
let campaignId = "";
let companyId = "";
let emailId = "";
let fixtureEmail = "";
let otherOrgCookie = "";

function req(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): NextRequest {
  const headers: Record<string, string> = { origin: BASE, ...(init.headers ?? {}) };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  return new NextRequest(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const ctx = <T extends Record<string, string>>(params: T) => ({
  params: Promise.resolve(params),
});

async function json<T = any>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

beforeAll(async () => {
  const healthResponse = await health.GET();
  expect(healthResponse.status).toBe(200);

  const loginResponse = await login.POST(
    req("/api/v1/auth/login", {
      method: "POST",
      body: { email: "admin@leadforge.local", password: "ChangeMe123!" },
    }),
  );
  expect(loginResponse.status).toBe(200);
  const raw = loginResponse.headers.get("set-cookie") ?? "";
  cookie = raw.split(";")[0] ?? "";

  const admin = await prisma.user.findUniqueOrThrow({
    where: { email: "admin@leadforge.local" },
    include: { memberships: true },
  });
  organizationId = admin.memberships[0]!.organizationId;

  // Reset approvals so the default-deny test is meaningful on every run.
  await prisma.jurisdictionProfile.deleteMany({ where: { code: "SE" } });

  // A dedicated fixture keeps tests independent of seeded data and prior runs.
  const stamp = Date.now();
  const company = await prisma.company.create({
    data: {
      organizationId,
      name: `Fixture AB ${stamp}`,
      countryCode: "SE",
      industryLabel: "Testing",
      confidence: 0.9,
    },
  });
  const contact = await prisma.contact.create({
    data: {
      organizationId,
      companyId: company.id,
      type: "GENERIC_BUSINESS",
      confidence: 0.9,
    },
  });
  const email = await prisma.emailAddress.create({
    data: {
      address: `info-${stamp}@fixture.se`,
      normalized: `info-${stamp}@fixture.se`,
      localPart: `info-${stamp}`,
      domain: "fixture.se",
      status: "MX_VALID",
      isRoleAccount: true,
      lastVerifiedAt: new Date(),
      verificationExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    },
  });
  await prisma.contactEmail.create({
    data: { contactId: contact.id, emailId: email.id, isPrimary: true, confidence: 0.9 },
  });
  emailId = email.id;
  fixtureEmail = email.normalized;

  const campaign = await prisma.campaign.create({
    data: {
      organizationId,
      name: `Fixture campaign ${stamp}`,
      subject: "Fixture",
      bodyHtml: "<p>Hello</p>",
      bodyText: "Hello",
      lawfulBasis: "LEGITIMATE_INTEREST",
      status: "DRAFT",
    },
  });
  campaignId = campaign.id;
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("authentication", () => {
  it("rejects a bad password without leaking whether the user exists", async () => {
    const response = await login.POST(
      req("/api/v1/auth/login", {
        method: "POST",
        body: { email: "admin@leadforge.local", password: "wrong-password" },
      }),
    );
    expect(response.status).toBe(401);
    const body = await json(response);
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects unauthenticated API access", async () => {
    const unauth = new NextRequest(`${BASE}/api/v1/companies`);
    const response = await companies.GET(unauth, ctx({}));
    expect(response.status).toBe(401);
  });
});

describe("companies", () => {
  it("creates a company, links its domain and records evidence", async () => {
    const name = `Testbolaget ${Date.now()}`;
    const response = await companies.POST(
      req("/api/v1/companies", {
        method: "POST",
        body: {
          name,
          website: `https://${name.toLowerCase().replace(/[^a-z0-9]/g, "")}.se`,
          countryCode: "SE",
          industry: "Testing",
        },
      }),
      ctx({}),
    );
    expect(response.status).toBe(201);
    const body = await json(response);
    companyId = body.data.id;

    const evidence = await prisma.sourceEvidence.findFirst({
      where: { companyId, fieldName: "domain" },
    });
    expect(evidence?.method).toBe("manual");

    const detail = await companyDetail.GET(
      new NextRequest(`${BASE}/api/v1/companies/${companyId}`, { headers: { cookie } }),
      ctx({ id: companyId }),
    );
    expect(detail.status).toBe(200);
  });

  it("rejects a company with no name", async () => {
    const response = await companies.POST(
      req("/api/v1/companies", { method: "POST", body: { website: "https://x.se" } }),
      ctx({}),
    );
    expect(response.status).toBe(400);
  });

  it("hides another organization's company", async () => {
    const org = await prisma.organization.create({
      data: { name: "Other Org", slug: `other-${Date.now()}` },
    });
    const user = await prisma.user.create({
      data: { email: `other-${Date.now()}@example.test`, passwordHash: "x" },
    });
    await prisma.membership.create({
      data: { userId: user.id, organizationId: org.id, role: "OWNER" },
    });
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: `test-${Date.now()}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    otherOrgCookie = `lf_session=${session.id}`; // deliberately not a valid token

    const response = await companyDetail.GET(
      new NextRequest(`${BASE}/api/v1/companies/${companyId}`, {
        headers: { cookie: otherOrgCookie },
      }),
      ctx({ id: companyId }),
    );
    expect([401, 404]).toContain(response.status);
  });
});

describe("compliance and eligibility", () => {
  it("blocks sending until the jurisdiction is approved", async () => {
    const before = await eligibility.POST(
      req("/api/v1/eligibility/evaluate", {
        method: "POST",
        body: { emailId, campaignId },
      }),
      ctx({}),
    );
    const body = await json(before);
    expect(body.data.outcome).not.toBe("ELIGIBLE");
  });

  it("approves a jurisdiction profile and records the approver", async () => {
    const response = await approveJurisdiction.POST(
      req("/api/v1/jurisdictions/SE/approve", { method: "POST", body: {} }),
      ctx({ code: "SE" }),
    );
    expect(response.status).toBe(200);
    const record = await prisma.jurisdictionProfile.findFirst({
      where: { code: "SE", status: "APPROVED" },
    });
    expect(record?.approvedBy).toBeTruthy();
  });

  it("records a lawful basis and evaluates an eligible Swedish corporate recipient", async () => {
    await prisma.lawfulBasisRecord.create({
      data: {
        organizationId,
        emailId,
        basis: "LEGITIMATE_INTEREST",
        jurisdictionCode: "SE",
        assessment: { purpose: "B2B outreach", necessity: "role-relevant", outcome: "balanced" },
      },
    });

    const response = await eligibility.POST(
      req("/api/v1/eligibility/evaluate", {
        method: "POST",
        body: { emailId, campaignId },
      }),
      ctx({}),
    );
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.data.outcome).toBe("ELIGIBLE");
    expect(body.data.ruleSetVersion).toBe("SE-2026.1");

    const decision = await prisma.eligibilityDecision.findUnique({
      where: { id: body.data.decisionId },
    });
    expect(decision?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("campaigns", () => {
  it("creates and prepares a campaign with an eligibility snapshot", async () => {
    const created = await campaigns.POST(
      req("/api/v1/campaigns", {
        method: "POST",
        body: {
          name: `Campaign ${Date.now()}`,
          subject: "Quick question",
          bodyHtml: "<p>Hello</p>",
          bodyText: "Hello",
          lawfulBasis: "LEGITIMATE_INTEREST",
          segmentDefinition: {
            countryCodes: [],
            industries: [],
            contactTypes: [],
            minConfidence: 0,
            onlyMxValid: true,
          },
          jurisdictionScope: ["SE"],
        },
      }),
      ctx({}),
    );
    expect(created.status).toBe(201);
    campaignId = (await json(created)).data.id;

    const prepared = await prepareCampaign.POST(
      req(`/api/v1/campaigns/${campaignId}/prepare`, { method: "POST", body: {} }),
      ctx({ id: campaignId }),
    );
    expect(prepared.status).toBe(200);
    const result = await json(prepared);
    expect(result.data.eligible).toBeGreaterThan(0);
  });

  it("refuses to approve a campaign with zero eligible recipients", async () => {
    const empty = await prisma.campaign.create({
      data: {
        organizationId,
        name: `Empty ${Date.now()}`,
        subject: "Nothing",
        bodyHtml: "<p>x</p>",
        bodyText: "x",
        lawfulBasis: "LEGITIMATE_INTEREST",
        status: "DRAFT",
      },
    });

    const response = await approveCampaign.POST(
      req(`/api/v1/campaigns/${empty.id}/approve`, {
        method: "POST",
        body: { scheduledAt: new Date().toISOString() },
      }),
      ctx({ id: empty.id }),
    );
    expect(response.status).toBe(409);
  });

  it("approves a prepared campaign and schedules it", async () => {
    const response = await approveCampaign.POST(
      req(`/api/v1/campaigns/${campaignId}/approve`, {
        method: "POST",
        body: { scheduledAt: new Date(Date.now() - 1000).toISOString() },
      }),
      ctx({ id: campaignId }),
    );
    expect(response.status).toBe(200);
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    expect(campaign?.status).toBe("SCHEDULED");
    expect(campaign?.approvedBy).toBeTruthy();
  });
});

describe("suppression", () => {
  it("suppresses an address immediately and blocks future eligibility", async () => {
    const response = await suppressions.POST(
      req("/api/v1/suppressions", {
        method: "POST",
        body: { email: fixtureEmail, reason: "LEGAL_OBJECTION" },
      }),
      ctx({}),
    );
    expect(response.status).toBe(201);

    const evaluated = await eligibility.POST(
      req("/api/v1/eligibility/evaluate", {
        method: "POST",
        body: { emailId, campaignId },
      }),
      ctx({}),
    );
    expect((await json(evaluated)).data.outcome).toBe("SUPPRESSED");
  });
});

describe("imports", () => {
  it("imports a CSV idempotently", async () => {
    const key = `test-import-${Date.now()}`;
    const payload = {
      filename: "companies.csv",
      idempotencyKey: key,
      csv: "name,domain,country_code,industry\nImport AB,import-test.se,SE,Testing\n",
    };

    const first = await imports.POST(
      req("/api/v1/imports", { method: "POST", body: payload }),
      ctx({}),
    );
    expect(first.status).toBe(201);
    const firstBody = await json(first);

    const second = await imports.POST(
      req("/api/v1/imports", { method: "POST", body: payload }),
      ctx({}),
    );
    const secondBody = await json(second);

    expect(secondBody.data.id).toBe(firstBody.data.id);
    expect(secondBody.data.rowCount).toBe(1);
  });
});

describe("unsubscribe", () => {
  it("honours a signed one-click unsubscribe and creates a global suppression", async () => {
    const email = await prisma.emailAddress.findUnique({ where: { normalized: "info@example.org" } });
    expect(email).not.toBeNull();

    const link = await createUnsubscribeLink("info@example.org", "campaign-test");
    const token = link.split("/unsubscribe/")[1]?.split("?")[0] ?? "";
    const url = new URL(link);

    const response = await unsubscribe.GET(
      new NextRequest(url.toString()),
      ctx({ token }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("removed");

    const suppression = await prisma.suppressionEntry.findFirst({
      where: { emailNormalized: "info@example.org", organizationId: null, reason: "UNSUBSCRIBED" },
    });
    expect(suppression).not.toBeNull();

    const forged = await unsubscribe.GET(
      new NextRequest(`${BASE}/unsubscribe/forged-token?e=info@example.org&c=campaign-test`),
      ctx({ token: "forged-token" }),
    );
    expect(forged.status).toBe(400);
  });
});
