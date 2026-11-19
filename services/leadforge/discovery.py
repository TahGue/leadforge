"""Discovery worker: claim a DiscoveryRun, run its source adapter, stage records.

Stages written here are spec section 9 steps 3-4 (plan source queries,
discover company candidates). Normalization and dedup happen in the
TypeScript company_normalization stage.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import UTC, datetime, timedelta

import httpx

from .config import settings
from .net import PolicyStop
from .safety import UnsafeUrlError
from .sources import get_adapter
from .sources.scope import load_scope
from .store import (
    AsyncConn,
    DiscoveryRun,
    claim_discovery_run,
    connect,
    finish_discovery_run,
    insert_company_candidates,
)

log = logging.getLogger("leadforge.discovery")
BATCH = 200
# Well inside the orchestrator's stale-job timeout (WORKER_STALE_RUNNING_MINUTES, default 30).
HEARTBEAT_SECONDS = 60.0


async def heartbeat(run_id: str, every: float = HEARTBEAT_SECONDS) -> None:
    """Keep a long run's lease alive. Uses its own connection: the run's connection is busy
    with the adapter and its batches, and must not be shared across tasks."""
    while True:
        await asyncio.sleep(every)
        try:
            async with await connect() as hb:
                await hb.execute(
                    """UPDATE "DiscoveryRun" SET "heartbeatAt" = now() WHERE id = %s AND status = 'RUNNING'""", (run_id,)
                )
                await hb.commit()
        except Exception as error:  # a missed beat is retried next interval; the run itself goes on
            log.warning("discovery heartbeat failed run=%s: %s", run_id, error)


def policy_refusal(run: DiscoveryRun) -> str | None:
    """A source runs only with an approved, enabled policy that permits automated access."""
    p = run.source_policy
    if p.get("policyStatus") != "APPROVED":
        return f"source_policy_{str(p.get('policyStatus', 'unreviewed')).lower()}"
    if not p.get("enabled"):
        return "source_disabled"
    if not p.get("permitted"):
        return "source_not_permitted"
    if run.source_type != "IMPORT" and not p.get("automatedAccessAllowed"):
        return "automated_access_not_confirmed"
    return None


async def process_one(conn: AsyncConn) -> bool:
    run = await claim_discovery_run(conn)
    if run is None:
        return False
    beat = asyncio.create_task(heartbeat(run.id))
    try:
        return await _process(conn, run)
    finally:
        beat.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await beat


async def _process(conn: AsyncConn, run: DiscoveryRun) -> bool:
    found = 0
    try:
        refusal = policy_refusal(run)
        if refusal:
            await finish_discovery_run(conn, run.id, "BLOCKED", found=0, policy_stop_reason=refusal)
            await conn.commit()
            log.warning("discovery blocked run=%s reason=%s", run.id, refusal)
            return True
        adapter = get_adapter(run.adapter, run.source_config, run.source_policy)
        if adapter is None:
            await finish_discovery_run(conn, run.id, "FAILED", found=0, error_code="unknown_adapter", error_message=str(run.adapter))
            await conn.commit()
            return True

        scope = await load_scope(conn, run.project_id)
        # Over-fetch to allow for rejects in normalization, within a hard ceiling.
        limit = min(run.max_companies * 3, settings.discovery_max_records)
        batch: list[dict[str, object]] = []
        capped = False
        async for record in adapter.search(run.query, scope, run.settings, limit):
            batch.append(record.row())
            if len(batch) >= BATCH:
                found += await insert_company_candidates(conn, run, batch)
                await conn.commit()
                batch.clear()
            if found + len(batch) >= limit:
                capped = True
                break
        if batch:
            found += await insert_company_candidates(conn, run, batch)
        await finish_discovery_run(
            conn,
            run.id,
            "PARTIAL" if capped or adapter.skipped_areas else "SUCCEEDED",
            found=found,
            metrics={
                "limit": limit,
                "capped": capped,
                "areas": len(scope.areas),
                "countries": scope.countries,
                "skippedAreas": adapter.skipped_areas,
            },
        )
        await conn.commit()
        log.info(
            "discovery run=%s adapter=%s records=%s capped=%s skipped=%s",
            run.id, run.adapter, found, capped, ",".join(adapter.skipped_areas) or "-",
        )
        return True
    except PolicyStop as stop:
        await conn.rollback()
        await finish_discovery_run(conn, run.id, "BLOCKED", found=found, policy_stop_reason=stop.reason)
        await conn.commit()
        return True
    except (UnsafeUrlError, ValueError, FileNotFoundError) as error:
        await conn.rollback()
        await finish_discovery_run(conn, run.id, "FAILED", found=found, error_code=type(error).__name__, error_message=str(error))
        await conn.commit()
        return True
    except (httpx.HTTPError, OSError) as error:
        await conn.rollback()
        if run.attempt_count < run.max_attempts:
            delay = timedelta(minutes=2 ** run.attempt_count)
            await finish_discovery_run(
                conn, run.id, "QUEUED", found=found, error_code="transient", error_message=str(error),
                retry_at=datetime.now(UTC) + delay,
            )
        else:
            await finish_discovery_run(conn, run.id, "FAILED", found=found, error_code="transient_exhausted", error_message=str(error))
        await conn.commit()
        return True
