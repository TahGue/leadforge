/**
 * BullMQ orchestration queues (ADR-0021).
 *
 * Postgres is the system of record: every job here can be reconstructed from
 * table state by the `refresh` sweep, so losing Redis delays work but never
 * loses it. Job IDs are deterministic so re-enqueueing the same work is a no-op.
 */
import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";

export const QUEUES = {
  discovery: "discovery",
  sourceSearch: "source_search",
  companyNormalization: "company_normalization",
  deduplicate: "deduplicate",
  verify: "verify",
  classify: "classify",
  export: "export",
  refresh: "refresh",
  deadLetter: "dead-letter",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 4,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 7 * 86_400 },
};

let connection: Redis | null = null;
const queues = new Map<string, Queue>();

export function redisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  return url ? url : null;
}

export function redisConnection(): Redis | null {
  const url = redisUrl();
  if (!url) return null;
  if (!connection) {
    connection = new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false });
    connection.on("error", (error: Error) => console.error("redis_error", error.message));
  }
  return connection;
}

export function getQueue(name: QueueName): Queue | null {
  const conn = redisConnection();
  if (!conn) return null;
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: conn, defaultJobOptions: DEFAULT_JOB_OPTIONS });
    queues.set(name, queue);
  }
  return queue;
}

/** BullMQ job ids may not contain ":"; keep them stable and readable. */
export function jobId(...parts: string[]): string {
  return parts.join("__").replace(/[^A-Za-z0-9_.-]/g, "-");
}

/**
 * Enqueue with a deterministic id. Returns false when Redis is not configured;
 * the refresh sweep in the worker then picks the work up from Postgres.
 */
export async function enqueue<T extends object>(
  name: QueueName,
  data: T,
  id: string,
  options: JobsOptions = {},
): Promise<boolean> {
  const queue = getQueue(name);
  if (!queue) return false;
  try {
    await queue.add(name, data, { jobId: id, ...options });
    return true;
  } catch (error) {
    console.error("enqueue_failed", name, (error as Error).message);
    return false;
  }
}

export async function queueCounts(): Promise<Record<string, Record<string, number>> | null> {
  if (!redisConnection()) return null;
  const result: Record<string, Record<string, number>> = {};
  for (const name of Object.values(QUEUES)) {
    const queue = getQueue(name);
    if (!queue) continue;
    try {
      result[name] = await queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
    } catch {
      result[name] = {};
    }
  }
  return result;
}

export async function pingRedis(): Promise<"ok" | "disabled" | "error"> {
  const conn = redisConnection();
  if (!conn) return "disabled";
  try {
    return (await conn.ping()) === "PONG" ? "ok" : "error";
  } catch {
    return "error";
  }
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
  if (connection) {
    connection.disconnect();
    connection = null;
  }
}
