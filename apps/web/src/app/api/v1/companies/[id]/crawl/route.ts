import { prisma } from "@leadforge/database";
import { createCrawlJob } from "@leadforge/pipeline";
import { ApiError } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Queue an ad-hoc crawl of the company's primary domain. Returns the crawl job id. */
export const POST = withAuth<{ id: string }>(async (_request, session, params) => {
  const company = await prisma.company.findFirst({
    where: { id: params.id, organizationId: session.organization.id, deletedAt: null },
    include: { domains: { include: { domain: true }, orderBy: { isPrimary: "desc" }, take: 1 } },
  });
  if (!company) throw new ApiError(404, "NOT_FOUND", "Company not found");
  const link = company.domains[0];
  if (!link) throw new ApiError(400, "VALIDATION_ERROR", "Company has no domain to crawl");
  const userSource = await prisma.source.findFirst({
    where: { organizationId: session.organization.id, adapter: "domain_list" },
    select: { id: true },
  });
  const jobId = await prisma.$transaction(async (tx) => {
    // Re-queue a finished ad-hoc job instead of creating a duplicate.
    const existing = await tx.crawlJob.findFirst({
      where: { projectId: null, companyId: company.id },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      if (existing.status === "QUEUED" || existing.status === "RUNNING") return existing.id;
      await tx.crawlJob.update({
        where: { id: existing.id },
        data: { status: "QUEUED", attemptCount: 0, scheduledFor: new Date(), errorCode: null, errorMessage: null, policyStopReason: null, finishedAt: null },
      });
      return existing.id;
    }
    return createCrawlJob(tx, {
      organizationId: session.organization.id,
      projectId: null,
      companyId: company.id,
      domainId: link.domainId,
      domain: link.domain.domain,
      sourceId: userSource?.id ?? null,
      maxPages: Number(process.env.CRAWLER_MAX_PAGES_PER_COMPANY ?? 12),
      maxDepth: Number(process.env.CRAWLER_MAX_DEPTH ?? 2),
      priority: 50,
    });
  });
  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "company.crawl",
    entity: "Company",
    entityId: company.id,
    metadata: { crawlJobId: jobId },
  });
  return json({ data: { jobId } }, 202);
}, "ANALYST");
