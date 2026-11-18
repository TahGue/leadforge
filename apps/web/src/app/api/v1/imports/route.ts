import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { stageImport } from "@leadforge/pipeline";
import { importRequest, parseBody } from "@leadforge/shared";
import { actorUserId, json, withAuth } from "@/lib/api";
import { audit } from "@/lib/audit";
import { parseCompanyCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (_request: NextRequest, session) => {
  const imports = await prisma.importJob.findMany({
    where: { organizationId: session.organization.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return json({ data: imports });
}, "VIEWER");

/**
 * CSV import of user-provided companies/domains. Rows are staged and normalized
 * through the same pipeline as every discovery source (dedup, geography,
 * taxonomy, provenance) and each company with a domain gets a crawl job.
 */
export const POST = withAuth(async (request: NextRequest, session) => {
  const input = await parseBody(request, importRequest);
  const existing = await prisma.importJob.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return json({ data: existing });

  const job = await prisma.importJob.create({
    data: {
      organizationId: session.organization.id,
      filename: input.filename,
      idempotencyKey: input.idempotencyKey,
      status: "RUNNING",
    },
  });

  const { rows, errors } = parseCompanyCsv(input.csv);
  try {
    const staged = await stageImport({
      organizationId: session.organization.id,
      userId: actorUserId(session),
      filename: input.filename,
      rows,
      importJobId: job.id,
    });
    const outcome = await prisma.companyCandidate.groupBy({
      by: ["status"],
      where: { projectId: staged.projectId },
      _count: { _all: true },
    });
    const counts = Object.fromEntries(outcome.map((o) => [o.status, o._count._all]));
    const rejected = await prisma.companyCandidate.findMany({
      where: { projectId: staged.projectId, status: "REJECTED" },
      select: { sourceRecordId: true, rejectReason: true },
      take: 200,
    });
    const report = [
      ...errors,
      ...rejected.map((r) => ({ row: Number(r.sourceRecordId.split(":")[1]), message: r.rejectReason ?? "rejected" })),
    ];
    const imported = (counts.CREATED ?? 0) + (counts.MERGED ?? 0);
    const finished = await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        rowCount: imported,
        errorCount: report.length,
        report: { projectId: staged.projectId, counts, issues: report.slice(0, 500) },
        finishedAt: new Date(),
      },
    });
    await audit({
      organizationId: session.organization.id,
      actorId: session.user.id,
      action: "import.completed",
      entity: "ImportJob",
      entityId: job.id,
      metadata: { imported, errors: report.length, projectId: staged.projectId },
    });
    return json({ data: finished }, 201);
  } catch (error) {
    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: (error as Error).message.slice(0, 1000), finishedAt: new Date() },
    });
    throw error;
  }
}, "ANALYST");
