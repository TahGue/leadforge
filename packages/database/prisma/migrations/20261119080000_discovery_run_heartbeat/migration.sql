-- Long multi-area discovery runs (e.g. one Overpass query per country) outlive the
-- stale-job timeout. Recovery judged them by startedAt and re-queued live runs; the
-- worker now refreshes heartbeatAt while a run is in progress.
ALTER TABLE "DiscoveryRun" ADD COLUMN "heartbeatAt" TIMESTAMP(3);
