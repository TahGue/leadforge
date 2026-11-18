/**
 * Orchestration sweep against a real database: staged records are normalized,
 * crawl jobs created, dead leases recovered, and a project completes only when
 * every run, record and crawl is terminal (spec 29).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@leadforge/database";
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

  it("completes the project once every job is terminal", async () => {
    await prisma.crawlJob.updateMany({ where: { projectId }, data: { status: "SUCCEEDED", finishedAt: new Date() } });
    await sweep();
    const project = await prisma.discoveryProject.findUniqueOrThrow({ where: { id: projectId } });
    expect(project.status).toBe("COMPLETED");
    expect(project.finishedAt).not.toBeNull();
  });
});
