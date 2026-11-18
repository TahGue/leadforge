import { prisma } from "@leadforge/database";
import { ApiError } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Retry a failed job. A BLOCKED job is a policy stop (robots, 401/403/429,
 * CAPTCHA) and is never retried automatically; an admin may re-queue it only
 * after resolving the cause, and that decision is audited.
 */
export const POST = withAuth<{ id: string }>(async (_request, session, params) => {
  const reset = {
    status: "QUEUED" as const,
    attemptCount: 0,
    errorCode: null,
    errorMessage: null,
    policyStopReason: null,
    scheduledFor: new Date(),
    nextRetryAt: null,
    finishedAt: null,
  };
  const crawl = await prisma.crawlJob.findFirst({ where: { id: params.id, organizationId: session.organization.id } });
  const run = crawl ? null : await prisma.discoveryRun.findFirst({ where: { id: params.id, organizationId: session.organization.id } });
  const job = crawl ?? run;
  if (!job) throw new ApiError(404, "NOT_FOUND", "Job not found");
  if (!["FAILED", "BLOCKED", "PARTIAL", "CANCELLED"].includes(job.status)) {
    throw new ApiError(409, "CONFLICT", `Job is ${job.status}; only finished jobs can be retried`);
  }
  if (job.status === "BLOCKED" && !["ADMIN", "OWNER"].includes(session.role)) {
    throw new ApiError(403, "FORBIDDEN", "Policy-blocked jobs can only be re-queued by an admin");
  }
  if (crawl) await prisma.crawlJob.update({ where: { id: crawl.id }, data: reset });
  else await prisma.discoveryRun.update({ where: { id: run!.id }, data: reset });
  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: crawl ? "crawl_job.retry" : "discovery_run.retry",
    entity: crawl ? "CrawlJob" : "DiscoveryRun",
    entityId: job.id,
    metadata: { previousStatus: job.status },
  });
  return json({ data: { id: job.id, status: "QUEUED" } }, 202);
}, "ANALYST");
