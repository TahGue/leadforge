/**
 * Prometheus metrics (spec section 22). Values are computed from Postgres at
 * scrape time, so they are correct across any number of web/worker replicas.
 */
import { Gauge, Registry, collectDefaultMetrics } from "prom-client";
import { prisma } from "@leadforge/database";
import { limits, queueCounts } from "@leadforge/pipeline";

const processRegistry = new Registry();
collectDefaultMetrics({ register: processRegistry, prefix: "leadforge_web_" });

function gauge(registry: Registry, name: string, help: string, labelNames: string[] = []) {
  return new Gauge({ name, help, labelNames, registers: [registry] });
}

export async function renderMetrics(): Promise<{ body: string; contentType: string }> {
  const registry = new Registry();
  const staleBefore = new Date(Date.now() - limits.companyFreshnessDays * 86_400_000);

  const [
    companies,
    contacts,
    emails,
    crawls,
    runs,
    candidates,
    stagings,
    duplicates,
    stale,
    pages,
    evidenceCoverage,
    httpStatuses,
    queues,
  ] = await Promise.all([
    prisma.company.count({ where: { deletedAt: null } }),
    prisma.contact.count({ where: { deletedAt: null } }),
    prisma.emailAddress.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.crawlJob.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.discoveryRun.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.extractionCandidate.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.companyCandidate.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.companyDuplicateCandidate.count({ where: { status: "OPEN" } }),
    prisma.company.count({ where: { deletedAt: null, lastSeenAt: { lt: staleBefore } } }),
    prisma.crawlJob.aggregate({ _sum: { pagesFetched: true, pagesSkipped: true, bytesDownloaded: true } }),
    prisma.contact.count({ where: { deletedAt: null, evidence: { some: {} } } }),
    prisma.crawlPage.groupBy({ by: ["httpStatus"], _count: { _all: true } }),
    queueCounts(),
  ]);

  gauge(registry, "leadforge_companies", "Companies (not deleted)").set(companies);
  gauge(registry, "leadforge_contacts", "Contacts (not deleted)").set(contacts);
  gauge(registry, "leadforge_contacts_with_evidence", "Contacts with at least one evidence row").set(evidenceCoverage);
  gauge(registry, "leadforge_companies_stale", "Companies not observed within the freshness window").set(stale);
  gauge(registry, "leadforge_duplicate_candidates_open", "Open duplicate candidates awaiting review").set(duplicates);

  const emailGauge = gauge(registry, "leadforge_emails", "Email addresses by summary status", ["status"]);
  emails.forEach((r) => emailGauge.set({ status: r.status }, r._count._all));
  const crawlGauge = gauge(registry, "leadforge_crawl_jobs", "Crawl jobs by status", ["status"]);
  crawls.forEach((r) => crawlGauge.set({ status: r.status }, r._count._all));
  const runGauge = gauge(registry, "leadforge_discovery_runs", "Discovery runs by status", ["status"]);
  runs.forEach((r) => runGauge.set({ status: r.status }, r._count._all));
  const candidateGauge = gauge(registry, "leadforge_extraction_candidates", "Extraction candidates by status", ["status"]);
  candidates.forEach((r) => candidateGauge.set({ status: r.status }, r._count._all));
  const stagingGauge = gauge(registry, "leadforge_company_candidates", "Staged company records by status", ["status"]);
  stagings.forEach((r) => stagingGauge.set({ status: r.status }, r._count._all));
  const httpGauge = gauge(registry, "leadforge_crawl_pages", "Crawled pages by HTTP status", ["status"]);
  httpStatuses.forEach((r) => httpGauge.set({ status: String(r.httpStatus ?? "none") }, r._count._all));

  gauge(registry, "leadforge_crawl_pages_fetched_total", "Pages fetched across all crawl jobs").set(pages._sum.pagesFetched ?? 0);
  gauge(registry, "leadforge_crawl_pages_skipped_total", "Pages skipped by policy or budget").set(pages._sum.pagesSkipped ?? 0);
  gauge(registry, "leadforge_crawl_bytes_total", "Bytes downloaded across all crawl jobs").set(pages._sum.bytesDownloaded ?? 0);

  const queueGauge = gauge(registry, "leadforge_queue_jobs", "BullMQ jobs by queue and state", ["queue", "state"]);
  for (const [queue, counts] of Object.entries(queues ?? {})) {
    for (const [state, value] of Object.entries(counts)) queueGauge.set({ queue, state }, value);
  }

  const merged = Registry.merge([registry, processRegistry]);
  return { body: await merged.metrics(), contentType: merged.contentType };
}
