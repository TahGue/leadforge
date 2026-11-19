/**
 * Keyword → industry suggestions through the real route and taxonomy. The local
 * AI is replaced by a stubbed Ollama response so the test is deterministic; the
 * real model is exercised by hand (docs/deployment.md, local AI).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { createSession } from "@/lib/auth";
import * as suggest from "@/app/api/v1/industries/suggest/route";

const BASE = "http://localhost:3000";
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let analystCookie = "";
let viewerCookie = "";
const orgs: string[] = [];
const users: string[] = [];

async function member(role: "ANALYST" | "VIEWER") {
  const org = await prisma.organization.create({ data: { name: `Suggest ${role} ${stamp}`, slug: `suggest-${role.toLowerCase()}-${stamp}` } });
  const user = await prisma.user.create({ data: { email: `${role.toLowerCase()}-${stamp}@suggest.test`, passwordHash: "unused" } });
  await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role } });
  orgs.push(org.id);
  users.push(user.id);
  const { token } = await createSession(user.id, {});
  return `lf_session=${encodeURIComponent(token)}`;
}

function post(body: unknown, cookie = analystCookie) {
  return new NextRequest(`${BASE}/api/v1/industries/suggest`, {
    method: "POST",
    headers: { origin: BASE, cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({}) };

beforeAll(async () => {
  analystCookie = await member("ANALYST");
  viewerCookie = await member("VIEWER");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
});

describe("POST /api/v1/industries/suggest", () => {
  it("matches the taxonomy when local AI is off", async () => {
    vi.stubEnv("OLLAMA_ENABLED", "false");
    const response = await suggest.POST(post({ query: "rörmokare" }), ctx);
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.method).toBe("TAXONOMY");
    expect(data.industries[0].code).toBe("construction.plumbing-hvac");
    expect(data.includeKeywords).toContain("rörmokare");
    expect(data.excludeKeywords).toEqual([]);
  });

  it("uses the local AI answer, validated against the taxonomy", async () => {
    vi.stubEnv("OLLAMA_ENABLED", "true");
    vi.stubEnv("OLLAMA_URL", "http://ollama.test:11434");
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push(url);
      expect(JSON.parse(String(init.body)).messages[1].content).toContain("agriculture-food.food-processing");
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              industries: [{ code: "agriculture-food.food-processing", confidence: 0.9, reason: "olive mills" }, { code: "invented" }],
              include: ["olive oil", "extra virgin", "producer"],
              exclude: ["supermarket", "olive oil"],
            }),
          },
        }),
      );
    });
    const response = await suggest.POST(post({ query: "olive oil producer" }), ctx);
    const { data } = await response.json();
    expect(calls).toEqual(["http://ollama.test:11434/api/chat"]);
    expect(data.method).toBe("AI");
    expect(data.industries.map((i: { code: string }) => i.code)).toEqual(["agriculture-food.food-processing"]);
    expect(data.industries[0].confidence).toBe(0.85);
    expect(data.includeKeywords).toEqual(["olive oil producer", "olive oil", "extra virgin"]);
    expect(data.excludeKeywords).toEqual(["supermarket"]);
  });

  it("falls back to the taxonomy and says why when the model is unreachable", async () => {
    vi.stubEnv("OLLAMA_ENABLED", "true");
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const { data } = await (await suggest.POST(post({ query: "rörmokare" }), ctx)).json();
    expect(data.method).toBe("TAXONOMY");
    expect(data.aiError).toBe("fetch failed");
    expect(data.industries[0].code).toBe("construction.plumbing-hvac");
  });

  it("validates input and requires the analyst role", async () => {
    expect((await suggest.POST(post({ query: "x" }), ctx)).status).toBe(400);
    expect((await suggest.POST(post({ query: "rörmokare" }, viewerCookie), ctx)).status).toBe(403);
  });
});
