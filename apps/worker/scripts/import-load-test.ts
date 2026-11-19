/**
 * Gate G2: a large CSV import stages, normalizes and resumes within budget.
 *
 *   pnpm --filter @leadforge/worker exec tsx scripts/import-load-test.ts 100000
 *
 * Uses a throwaway organization ("importload", deleted at the end) and
 * synthetic .se domains. Run it against a development database with no crawler
 * attached: normalization creates crawl jobs for the synthetic domains.
 * Steps: stage all rows (the API path for imports over 500 rows), normalize half,
 * "crash", then resume the rest. (Import idempotency is enforced by the API's
 * idempotency key and tested in api.integration.test.ts.)
 */
import { prisma } from "@leadforge/database";
import { processPendingCandidates, stageImport } from "@leadforge/pipeline";

const SLUG = "importload";
const total = Number(process.argv[2] ?? 100_000);
const BATCH = 1_000;

async function main() {
  await prisma.organization.deleteMany({ where: { slug: SLUG } });
  const org = await prisma.organization.create({ data: { name: "Import load test", slug: SLUG } });
  const cities = ["Göteborg", "Stockholm", "Malmö", "Uppsala"];
  const rows = Array.from({ length: total }, (_, i) => ({
    name: `Importlast ${i} AB`,
    domain: `lf-importload-${i}.se`,
    countryCode: "SE",
    city: cities[i % cities.length],
    industry: "Construction",
  }));
  const importJobId = `importload-${Date.now()}`;

  try {
    let started = Date.now();
    const staged = await stageImport({ organizationId: org.id, userId: null, filename: "load.csv", rows, importJobId });
    const stageMs = Date.now() - started;


    started = Date.now();
    let processed = 0;
    while (processed < total / 2) {
      const n = await processPendingCandidates(BATCH, staged.projectId);
      if (!n) break;
      processed += n;
    }
    // Simulated crash here: nothing in memory survives; pending rows stay in Postgres.
    const pendingAfterCrash = await prisma.companyCandidate.count({ where: { projectId: staged.projectId, status: "PENDING" } });
    for (;;) {
      const n = await processPendingCandidates(BATCH, staged.projectId);
      if (!n) break;
      processed += n;
    }
    const normalizeMs = Date.now() - started;

    const outcome = await prisma.companyCandidate.groupBy({
      by: ["status"],
      where: { projectId: staged.projectId },
      _count: { _all: true },
    });
    const companies = await prisma.company.count({ where: { organizationId: org.id } });
    console.log(
      JSON.stringify(
        {
          rows: total,
          stageSeconds: +(stageMs / 1000).toFixed(1),
          pendingAfterSimulatedCrash: pendingAfterCrash,
          normalizeSeconds: +(normalizeMs / 1000).toFixed(1),
          totalSeconds: +((stageMs + normalizeMs) / 1000).toFixed(1),
          outcome: Object.fromEntries(outcome.map((o) => [o.status, o._count._all])),
          companies,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
