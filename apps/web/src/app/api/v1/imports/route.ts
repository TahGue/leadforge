import type { NextRequest } from "next/server";
import { prisma } from "@leadforge/database";
import { importRequest, parseBody } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";
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

export const POST = withAuth(async (request: NextRequest, session) => {
  const input = await parseBody(request, importRequest);

  const existing = await prisma.importJob.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
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
  let imported = 0;

  for (const row of rows) {
    try {
      await prisma.$transaction(async (tx) => {
        const domain = await tx.domain.upsert({
          where: { domain: row.domain },
          create: {
            domain: row.domain,
            registrableDomain: row.domain,
            tld: row.domain.split(".").slice(-1)[0] ?? "",
          },
          update: {},
        });

        const existing = await tx.company.findFirst({
          where: {
            organizationId: session.organization.id,
            name: row.name,
            countryCode: row.countryCode ?? null,
          },
        });

        const company = existing
          ? await tx.company.update({
              where: { id: existing.id },
              data: { lastSeenAt: new Date(), industry: row.industry ?? existing.industry },
            })
          : await tx.company.create({
              data: {
                organizationId: session.organization.id,
                name: row.name,
                countryCode: row.countryCode,
                industry: row.industry,
                website: row.website,
                confidence: 0.5,
              },
            });

        await tx.companyDomain.upsert({
          where: { domainId: domain.id },
          create: { companyId: company.id, domainId: domain.id, isPrimary: true },
          update: {},
        });
      });
      imported += 1;
    } catch (error) {
      errors.push({ row: imported + 1, message: (error as Error).message });
    }
  }

  const finished = await prisma.importJob.update({
    where: { id: job.id },
    data: {
      status: "COMPLETED",
      rowCount: imported,
      errorCount: errors.length,
      report: errors.slice(0, 500),
      finishedAt: new Date(),
    },
  });

  await audit({
    organizationId: session.organization.id,
    actorId: session.user.id,
    action: "import.completed",
    entity: "ImportJob",
    entityId: job.id,
    metadata: { imported, errors: errors.length },
  });

  return json({ data: finished }, 201);
}, "ANALYST");
