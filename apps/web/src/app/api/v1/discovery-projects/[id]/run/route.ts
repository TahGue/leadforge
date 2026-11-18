import type { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { prisma } from "@leadforge/database";
import { ApiError } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";
import { normalizeDomain } from "@/lib/csv";

export const dynamic = "force-dynamic";

/**
 * Materialises crawl targets for a project from already-known companies.
 * Nothing is fetched here: the Python worker claims QUEUED targets.
 */
export const POST = withAuth<{ id: string }>(async (_request, session, params) => {
  const project = await prisma.discoveryProject.findFirst({
    where: { id: params.id, organizationId: session.organization.id },
  });
  if (!project) throw new ApiError(404, "NOT_FOUND", "Project not found");

  const criteria = project.criteria as {
    countries?: string[];
    industries?: string[];
    maxTargets?: number;
  };
  const budget = project.budget as { maxTargets?: number; maxPagesPerDomain?: number };

  const companies = await prisma.company.findMany({
    where: {
      organizationId: session.organization.id,
      deletedAt: null,
      ...(criteria.countries?.length ? { countryCode: { in: criteria.countries } } : {}),
      ...(criteria.industries?.length ? { industry: { in: criteria.industries } } : {}),
    },
    include: { domains: { include: { domain: true } } },
    take: budget.maxTargets ?? criteria.maxTargets ?? 500,
  });

  let created = 0;
  let skipped = 0;

  for (const company of companies) {
    const domain = company.domains[0]?.domain;
    if (!domain) {
      skipped += 1;
      continue;
    }
    const url = `https://${normalizeDomain(domain.domain)}/`;
    const urlHash = createHash("sha256").update(url).digest("hex");

    const existing = await prisma.crawlTarget.findFirst({
      where: { projectId: project.id, urlHash },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    await prisma.crawlTarget.create({
      data: {
        organizationId: session.organization.id,
        projectId: project.id,
        domainId: domain.id,
        url,
        urlHash,
        depth: 0,
        priority: 100,
        status: "QUEUED",
      },
    });
    created += 1;
  }

  await prisma.discoveryProject.update({
    where: { id: project.id },
    data: { status: "RUNNING" },
  });

  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "discovery_project.run",
    entity: "DiscoveryProject",
    entityId: project.id,
    metadata: { created, skipped, companies: companies.length },
  });

  return json({ data: { created, skipped, companies: companies.length } }, 202);
}, "ANALYST");
