/**
 * LeadForge orchestration worker (ADR-0021).
 *
 *  - BullMQ consumers for the TypeScript stages (company_normalization,
 *    verify, deduplicate, discovery, refresh) when REDIS_URL is set;
 *  - a Postgres sweep that does the same work from table state, so the
 *    pipeline is correct with Redis down or absent;
 *  - the campaign loop, only when FEATURE_CAMPAIGNS=true (Phase 9).
 *
 * Python workers (services/leadforge) claim discovery runs and crawl jobs
 * directly from Postgres.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Worker, type Job } from "bullmq";
import { prisma } from "@leadforge/database";
import { describeError } from "@leadforge/shared";
import {
  QUEUES,
  applyRetention,
  closeQueues,
  emailsDueForVerification,
  enqueue,
  features,
  finalizeProjects,
  getQueue,
  jobId,
  processCandidate,
  processPendingCandidates,
  redisConnection,
  scanDuplicates,
  verifyEmail,
} from "@leadforge/pipeline";
import { tick as campaignTick } from "./campaigns";

const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(here, "../../../.env") });

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 15_000);
const STALE_RUNNING_MINUTES = Number(process.env.WORKER_STALE_RUNNING_MINUTES ?? 30);
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const log = (event: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", service: "worker", event, ...fields }));
const logError = (event: string, error: unknown, fields: Record<string, unknown> = {}) =>
  console.error(
    JSON.stringify({ ts: new Date().toISOString(), level: "error", service: "worker", event, error: describeError(error).message, ...fields }),
  );

/** Re-queue jobs whose worker died mid-run (lease expiry). Policy-blocked jobs are never touched. */
export async function recoverStaleJobs(now = new Date()): Promise<{ crawls: number; runs: number }> {
  const cutoff = new Date(now.getTime() - STALE_RUNNING_MINUTES * 60_000);
  const crawls = await prisma.crawlJob.updateMany({
    where: { status: "RUNNING", updatedAt: { lt: cutoff } },
    data: { status: "QUEUED", scheduledFor: now, errorCode: "lease_expired" },
  });
  // A discovery run is alive while its worker refreshes heartbeatAt; runs claimed before
  // heartbeats existed fall back to startedAt.
  const runs = await prisma.discoveryRun.updateMany({
    where: {
      status: "RUNNING",
      OR: [{ heartbeatAt: { lt: cutoff } }, { heartbeatAt: null, startedAt: { lt: cutoff } }],
    },
    data: { status: "QUEUED", scheduledFor: now, errorCode: "lease_expired" },
  });
  return { crawls: crawls.count, runs: runs.count };
}

/** Bounded email verification pass (syntax + DNS + MX). */
export async function verifyDue(limit = 50): Promise<number> {
  const ids = await emailsDueForVerification(limit);
  for (const id of ids) {
    try {
      await verifyEmail(id);
    } catch (error) {
      logError("verify_failed", error, { emailId: id });
    }
  }
  return ids.length;
}

const lastRun: Record<string, number> = {};
function due(name: string, everyMs: number, now = Date.now()): boolean {
  if ((lastRun[name] ?? 0) + everyMs > now) return false;
  lastRun[name] = now;
  return true;
}

/** One sweep over Postgres state. Idempotent; safe to run on several replicas. */
export async function sweep(): Promise<Record<string, unknown>> {
  const report: Record<string, unknown> = {};
  report.recovered = await recoverStaleJobs();
  report.normalized = await processPendingCandidates(200);
  report.verified = await verifyDue(50);
  report.completed = await finalizeProjects();
  if (due("dedupe", HOUR_MS)) {
    const orgs = await prisma.organization.findMany({ select: { id: true } });
    let added = 0;
    for (const org of orgs) added += await scanDuplicates(org.id);
    report.duplicates = added;
  }
  if (due("retention", DAY_MS)) report.retention = await applyRetention();
  if (features.campaigns) await campaignTick();
  return report;
}

function startQueueWorkers(): Worker[] {
  const connection = redisConnection();
  if (!connection) {
    log("redis_disabled", { note: "orchestration runs from the Postgres sweep only" });
    return [];
  }
  const deadLetter = async (job: Job | undefined, error: Error) => {
    if (!job || (job.attemptsMade ?? 0) < (job.opts.attempts ?? 1)) return;
    await enqueue(QUEUES.deadLetter, { queue: job.queueName, data: job.data, error: error.message }, jobId("dlq", job.queueName, job.id ?? "x"));
  };
  const make = <T>(name: string, handler: (job: Job<T>) => Promise<unknown>, concurrency = 2) => {
    const worker = new Worker<T>(name, handler, { connection, concurrency });
    worker.on("failed", (job, error) => {
      logError("job_failed", error, { queue: name, jobId: job?.id });
      void deadLetter(job, error);
    });
    return worker;
  };

  return [
    make<{ candidateId: string }>(QUEUES.companyNormalization, async (job) => processCandidate(job.data.candidateId), 4),
    make<{ emailId: string }>(QUEUES.verify, async (job) => verifyEmail(job.data.emailId), 4),
    make<{ organizationId: string }>(QUEUES.deduplicate, async (job) => scanDuplicates(job.data.organizationId), 1),
    // A project start/resume nudges an immediate sweep so new runs are visible quickly.
    make<{ projectId: string }>(QUEUES.discovery, async (job) => processPendingCandidates(500, job.data.projectId), 1),
    make<Record<string, never>>(QUEUES.refresh, async () => sweep(), 1),
  ];
}

async function main(): Promise<void> {
  log("worker_start", { pollMs: POLL_MS, campaigns: features.campaigns, redis: Boolean(redisConnection()) });
  if (process.env.WORKER_ONCE === "true") {
    log("sweep", await sweep());
    await prisma.$disconnect();
    await closeQueues();
    return;
  }

  const workers = startQueueWorkers();
  const refresh = getQueue(QUEUES.refresh);
  if (refresh) {
    // A repeatable refresh job: the BullMQ path; the timer below is the fallback.
    await refresh.upsertJobScheduler("refresh-every-minute", { every: 60_000 }, { name: "refresh", data: {} });
  }

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    log("worker_stop");
    await Promise.all(workers.map((w) => w.close()));
    await closeQueues();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (!stopping) {
    try {
      const report = await sweep();
      if (Object.values(report).some((v) => (typeof v === "number" ? v > 0 : Array.isArray(v) ? v.length > 0 : v && typeof v === "object"))) {
        log("sweep", report);
      }
    } catch (error) {
      logError("sweep_failed", error);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

export { campaignTick as tick };
export { processCampaign } from "./campaigns";

if (process.env.WORKER_NO_AUTOSTART !== "true") {
  void main();
}
