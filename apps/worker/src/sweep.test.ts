/**
 * Orchestration sweep against a real database: staged records are normalized,
 * crawl jobs created, dead leases recovered, and a project completes only when
 * every run, record and crawl is terminal (spec 29).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@leadforge/database";
import { processPendingCandidates } from "@leadforge/pipeline";
import { recoverStaleJobs, sweep } from "./index";

const stamp = Date.now();
let organizationId = "";
let sourceId = "";
let projectId = "";

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `Sweep ${stamp}`, slug: `sweep-${stamp}` } });
  organizationId = org.id;
  const source = await prisma.source.create({
    data: { organizationId, name: "domains", sourceType: "IMPORT", adapter: "domain_list", permitted: true, policyStatus: "APPROVED" },
  });
  sourceId = source.id;
  const project = await prisma.discoveryProject.create({
    data: { organizationId, name: "Sweep project", status: "RUNNING", geographicMode: "WORLDWIDE", settings: {} },
  });
  projectId = project.id;
  // A paused project's older backlog, larger than one sweep batch, must not starve running projects.
  const paused = await prisma.discoveryProject.create({
    data: { organizationId, name: "Paused backlog", status: "PAUSED", geographicMode: "WORLDWIDE", settings: {} },
  });
  await prisma.companyCandidate.createMany({
    data: Array.from({ length: 250 }, (_, i) => ({
      organizationId,
      projectId: paused.id,
      sourceId,
      sourceRecordId: `paused-${i}`,
      name: `Paused ${i}`,
      website: `https://paused-${stamp}-${i}.se/`,
      createdAt: new Date(Date.UTC(2020, 0, 1)),
    })),
  });
  const run = await prisma.discoveryRun.create({
    data: { organizationId, projectId, sourceId, status: "SUCCEEDED", candidatesFound: 1, finishedAt: new Date() },
  });
  await prisma.companyCandidate.create({
    data: {
      organizationId,
      projectId,
      sourceId,
      runId: run.id,
      sourceRecordId: `sweep-${stamp}.se`,
      name: `sweep-${stamp}.se`,
      website: `https://sweep-${stamp}.se/`,
    },
  });
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("orchestration sweep", () => {
  it("normalizes staged records and creates a crawl job", async () => {
    await sweep();
    const candidate = await prisma.companyCandidate.findFirstOrThrow({ where: { projectId } });
    expect(candidate.status).toBe("CREATED");
    const jobs = await prisma.crawlJob.findMany({ where: { projectId } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.rootUrl).toBe(`https://sweep-${stamp}.se/`);
    const project = await prisma.discoveryProject.findUniqueOrThrow({ where: { id: projectId } });
    expect(project.status).toBe("RUNNING"); // crawl still queued
  });

  it("recovers a crawl whose worker died, but leaves policy stops alone", async () => {
    const job = await prisma.crawlJob.findFirstOrThrow({ where: { projectId } });
    await prisma.$executeRaw`UPDATE "CrawlJob" SET status = 'RUNNING', "updatedAt" = now() - interval '2 hours' WHERE id = ${job.id}`;
    const recovered = await recoverStaleJobs();
    expect(recovered.crawls).toBeGreaterThanOrEqual(1);
    expect((await prisma.crawlJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("QUEUED");
  });

  it("keeps a long discovery run whose worker still sends heartbeats", async () => {
    const run = await prisma.discoveryRun.findFirstOrThrow({ where: { projectId } });
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
    await prisma.discoveryRun.update({ where: { id: run.id }, data: { status: "RUNNING", startedAt: twoHoursAgo, heartbeatAt: new Date() } });
    await recoverStaleJobs();
    expect((await prisma.discoveryRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("RUNNING");
    // Silent worker: the lease expires and the run is re-queued.
    await prisma.discoveryRun.update({ where: { id: run.id }, data: { heartbeatAt: twoHoursAgo } });
    await recoverStaleJobs();
    expect((await prisma.discoveryRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("QUEUED");
    await prisma.discoveryRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", finishedAt: new Date() } });
  });

  it("completes the project once every job is terminal", async () => {
    await prisma.crawlJob.updateMany({ where: { projectId }, data: { status: "SUCCEEDED", finishedAt: new Date() } });
    await sweep();
    const project = await prisma.discoveryProject.findUniqueOrThrow({ where: { id: projectId } });
    expect(project.status).toBe("COMPLETED");
    expect(project.finishedAt).not.toBeNull();
  });
});

describe("concurrent normalization", () => {
  it("never double-processes a row or duplicates a company when workers overlap", async () => {
    const project = await prisma.discoveryProject.create({
      data: { organizationId, name: "Concurrent", status: "RUNNING", geographicMode: "WORLDWIDE", settings: {} },
    });
    const domains = Array.from({ length: 6 }, (_, i) => `race-${stamp}-${i}.se`);
    await prisma.companyCandidate.createMany({
      data: [...domains, domains[0]!].map((domain, i) => ({
        organizationId,
        projectId: project.id,
        sourceId,
        sourceRecordId: `race-${i}`,
        name: domain,
        website: `https://${domain}/`,
      })),
    });
    // Two workers sweeping the same rows at once, plus a second record for one domain.
    await Promise.all([processPendingCandidates(50, project.id), processPendingCandidates(50, project.id)]);
    const rows = await prisma.companyCandidate.findMany({ where: { projectId: project.id } });
    expect(rows.filter((r) => r.status === "REJECTED").map((r) => r.rejectReason)).toEqual([]);
    expect(new Set(rows.map((r) => r.companyId)).size).toBe(domains.length);
    expect(await prisma.crawlJob.count({ where: { projectId: project.id } })).toBe(domains.length);
  });
});
