/**
 * Tenant-leak suite (quality gate G1): a signed-in member of another
 * organization must not read, list or change this organization's records.
 * Both sessions are real, so a pass means org scoping held, not that auth failed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { createSession } from "@/lib/auth";
import * as companies from "@/app/api/v1/companies/route";
import * as companyDetail from "@/app/api/v1/companies/[id]/route";
import * as contacts from "@/app/api/v1/contacts/route";
import * as contactDetail from "@/app/api/v1/contacts/[id]/route";
import * as projects from "@/app/api/v1/discovery-projects/route";
import * as projectDetail from "@/app/api/v1/discovery-projects/[id]/route";
import * as sourceDetail from "@/app/api/v1/sources/[id]/route";

const BASE = "http://localhost:3000";
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let ownerCookie = "";
let intruderCookie = "";
const ids = { company: "", contact: "", project: "", source: "" };
const createdOrgs: string[] = [];
const createdUsers: string[] = [];

function req(path: string, cookie: string, init: { method?: string; body?: unknown } = {}): NextRequest {
  const headers: Record<string, string> = { origin: BASE, cookie };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

async function member(label: string) {
  const org = await prisma.organization.create({ data: { name: `Tenant ${label} ${stamp}`, slug: `tenant-${label}-${stamp}` } });
  const user = await prisma.user.create({ data: { email: `${label}-${stamp}@tenant.test`, passwordHash: "unused" } });
  await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: "OWNER" } });
  createdOrgs.push(org.id);
  createdUsers.push(user.id);
  const { token } = await createSession(user.id, {});
  return { org, user, cookie: `lf_session=${encodeURIComponent(token)}` };
}

beforeAll(async () => {
  const owner = await member("owner");
  const intruder = await member("intruder");
  // A cookie set by something else first (a proxy, analytics) must not break auth.
  ownerCookie = `lf_theme=dark; ${owner.cookie}`;
  intruderCookie = intruder.cookie;

  const company = await prisma.company.create({
    data: { organizationId: owner.org.id, name: `Secret AB ${stamp}`, countryCode: "SE", confidence: 0.9 },
  });
  const contact = await prisma.contact.create({
    data: { organizationId: owner.org.id, companyId: company.id, type: "GENERIC_BUSINESS", confidence: 0.9 },
  });
  const project = await prisma.discoveryProject.create({
    data: { organizationId: owner.org.id, name: `Secret project ${stamp}` },
  });
  const source = await prisma.source.create({
    data: { organizationId: owner.org.id, name: `Secret source ${stamp}`, sourceType: "DOMAIN_LIST", adapter: "domain_list" },
  });
  Object.assign(ids, { company: company.id, contact: contact.id, project: project.id, source: source.id });
}, 60_000);

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgs } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe("tenant isolation", () => {
  it("lets the owning organization read its records (the suite is not vacuous)", async () => {
    expect((await companyDetail.GET(req(`/api/v1/companies/${ids.company}`, ownerCookie), ctx({ id: ids.company }))).status).toBe(200);
    expect((await contactDetail.GET(req(`/api/v1/contacts/${ids.contact}`, ownerCookie), ctx({ id: ids.contact }))).status).toBe(200);
    expect((await projectDetail.GET(req(`/api/v1/discovery-projects/${ids.project}`, ownerCookie), ctx({ id: ids.project }))).status).toBe(200);
    expect((await sourceDetail.GET(req(`/api/v1/sources/${ids.source}`, ownerCookie), ctx({ id: ids.source }))).status).toBe(200);
  });

  it("returns 404 for another organization's company, contact, project and source", async () => {
    const responses = await Promise.all([
      companyDetail.GET(req(`/api/v1/companies/${ids.company}`, intruderCookie), ctx({ id: ids.company })),
      contactDetail.GET(req(`/api/v1/contacts/${ids.contact}`, intruderCookie), ctx({ id: ids.contact })),
      projectDetail.GET(req(`/api/v1/discovery-projects/${ids.project}`, intruderCookie), ctx({ id: ids.project })),
      sourceDetail.GET(req(`/api/v1/sources/${ids.source}`, intruderCookie), ctx({ id: ids.source })),
    ]);
    expect(responses.map((r) => r.status)).toEqual([404, 404, 404, 404]);
  });

  it("leaves nothing of another organization in list endpoints", async () => {
    for (const [handler, path] of [
      [companies.GET, "/api/v1/companies?limit=200"],
      [contacts.GET, "/api/v1/contacts?limit=200"],
      [projects.GET, "/api/v1/discovery-projects"],
    ] as const) {
      const response = await handler(req(path, intruderCookie), ctx({}));
      expect(response.status).toBe(200);
      const body = await response.text();
      for (const id of Object.values(ids)) expect(body).not.toContain(id);
      expect(body).not.toContain(`Secret AB ${stamp}`);
    }
  });

  it("refuses to change another organization's records", async () => {
    const patch = await companyDetail.PATCH(
      req(`/api/v1/companies/${ids.company}`, intruderCookie, { method: "PATCH", body: { name: "Hijacked" } }),
      ctx({ id: ids.company }),
    );
    expect(patch.status).toBe(404);
    const removal = await projectDetail.DELETE(
      req(`/api/v1/discovery-projects/${ids.project}`, intruderCookie, { method: "DELETE" }),
      ctx({ id: ids.project }),
    );
    expect(removal.status).toBe(404);
    const company = await prisma.company.findUniqueOrThrow({ where: { id: ids.company } });
    expect(company.name).toBe(`Secret AB ${stamp}`);
    expect(await prisma.discoveryProject.count({ where: { id: ids.project } })).toBe(1);
  });
});
