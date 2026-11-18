"""Website crawler: one CrawlJob = one company site (spec sections 11 and 12).

For each job: robots.txt and policy checks, bounded breadth-first crawl of
same-site pages ordered by likely relevance (contact, about, team, sales,
press, careers), deterministic extraction, evidence storage, and
auto-promotion of only the safest contacts. Everything else waits for review.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit

import httpx

from . import render
from .config import settings
from .extract import EXTRACTOR_VERSION, Candidate, extract_page
from .net import TRANSIENT_STATUSES, PolicyStop, fetch, registrable
from .normalize import normalize_email
from .robots import AsyncRobotsCache
from .safety import UnsafeUrlError, validate_url
from .store import (
    AsyncConn,
    CrawlJob,
    claim_crawl_job,
    cooldown_domain,
    finish_crawl_job,
    finish_extraction_run,
    heartbeat,
    insert_candidate,
    is_domain_suppressed,
    is_suppressed,
    pause_project_if_blocked,
    project_status,
    promote_candidate,
    record_page,
    record_page_fact,
    reject_candidate,
    save_artifact,
    start_extraction_run,
    touch_domain,
    update_company_after_crawl,
)

log = logging.getLogger("leadforge.crawler")

KIND_PRIORITY = {"HOME": 0, "CONTACT": 1, "ABOUT": 2, "TEAM": 3, "SALES": 4, "PRESS": 5, "CAREERS": 6, "OTHER": 9}
DETERMINISTIC = {"mailto", "tel", "jsonld"}


@dataclass
class CrawlOutcome:
    status: str
    pages_fetched: int = 0
    pages_skipped: int = 0
    bytes: int = 0
    candidates: int = 0
    promoted: int = 0
    error_code: str | None = None
    error_message: str | None = None
    policy_stop: str | None = None
    retry_at: datetime | None = None
    kinds: dict[str, int] = field(default_factory=dict)


def crawl_settings(job: CrawlJob) -> dict[str, Any]:
    crawl = (job.settings or {}).get("crawl") or {}
    return {
        "rpm": int(crawl.get("requestsPerDomainPerMinute") or 6),
        "timeout": float(crawl.get("timeoutSeconds") or settings.crawler_timeout_seconds),
        "max_bytes": int(float(crawl.get("maxResponseMb") or settings.crawler_max_response_mb) * 1024 * 1024),
        "accepted": crawl.get("acceptedContentTypes") or ["text/html", "application/xhtml+xml"],
        "allowed": [re.compile(p) for p in crawl.get("allowedUrlPatterns") or []],
        "excluded": [re.compile(p) for p in crawl.get("excludedUrlPatterns") or []],
        "playwright": bool(crawl.get("usePlaywright")) and settings.crawler_playwright_enabled,
        "stop_after_blocked": int(crawl.get("stopAfterBlocked") or 5),
    }


def url_permitted(url: str, allowed: list[re.Pattern[str]], excluded: list[re.Pattern[str]]) -> bool:
    if any(p.search(url) for p in excluded):
        return False
    return not allowed or any(p.search(url) for p in allowed)


def should_auto_promote(candidate: Candidate, company_domain: str | None, threshold: float) -> tuple[bool, str | None]:
    """Only deterministic, on-domain, role-based contacts are promoted without a person."""
    if candidate.kind == "CONTACT_FORM":
        return True, None
    if candidate.method not in DETERMINISTIC or candidate.confidence < threshold:
        return False, None
    if candidate.kind == "PHONE":
        return True, None
    normalized = normalize_email(candidate.normalized_value)
    if not normalized.valid:
        return False, "invalid"
    if normalized.is_free_provider or normalized.is_disposable:
        return False, None
    if company_domain and registrable(normalized.domain) != company_domain:
        return False, None
    # Named individuals always go to human review (spec 18: separate role accounts from people).
    if candidate.category == "NAMED" or not normalized.is_role_account:
        return False, None
    return True, None


def needs_render(body: bytes) -> bool:
    """Heuristic: very little visible text but script-heavy, typical of client-rendered sites."""
    sample = body[:300_000].lower()
    text = re.sub(rb"<script.*?</script>|<style.*?</style>|<[^>]+>", b" ", sample, flags=re.S)
    return len(text.split()) < 40 and sample.count(b"<script") >= 3


async def crawl_job(
    conn: AsyncConn,
    client: httpx.AsyncClient,
    robots: AsyncRobotsCache,
    job: CrawlJob,
    *,
    validator: Any = validate_url,
    sleep: Any = asyncio.sleep,
) -> CrawlOutcome:
    cfg = crawl_settings(job)
    outcome = CrawlOutcome(status="SUCCEEDED")
    site = registrable(urlsplit(job.root_url).hostname or "") if not job.domain else job.domain
    if await is_domain_suppressed(conn, job.organization_id, site):
        # A site owner objected after the job was queued: never fetch it.
        outcome.status, outcome.error_code = "CANCELLED", "domain_suppressed"
        return outcome
    delay = max(60.0 / max(cfg["rpm"], 1), settings.crawler_delay_ms / 1000)
    robots_entry = await robots.entry(job.root_url)
    if robots_entry.crawl_delay:
        delay = max(delay, robots_entry.crawl_delay)

    queue: deque[tuple[str, int, str]] = deque([(job.root_url, 0, "HOME")])
    visited: set[str] = set()
    facts: dict[str, Any] = {"https": None, "language": None, "description": None, "technologies": set(), "social": set(), "contact": False, "careers": False}
    root_ok = False
    errors = 0

    while queue and outcome.pages_fetched < job.max_pages:
        url, depth, kind = queue.popleft()
        key = url.rstrip("/").lower()
        if key in visited:
            continue
        visited.add(key)

        status = await project_status(conn, job.project_id)
        if status in {"PAUSED", "CANCELLED"}:
            outcome.status = "CANCELLED" if status == "CANCELLED" else "QUEUED"
            outcome.error_code = f"project_{status.lower()}"
            break

        if depth > 0 and not url_permitted(url, cfg["allowed"], cfg["excluded"]):
            outcome.pages_skipped += 1
            await record_page(conn, job_id=job.id, url=url, final_url=None, depth=depth, kind=kind, http_status=None, content_type=None,
                              content_hash=None, duration_ms=0, bytes_received=0, render_mode="HTTP", parse_status="SKIPPED",
                              skip_reason="url_pattern", artifact_id=None)
            continue
        if not await robots.allowed(url):
            outcome.pages_skipped += 1
            await record_page(conn, job_id=job.id, url=url, final_url=None, depth=depth, kind=kind, http_status=None, content_type=None,
                              content_hash=None, duration_ms=0, bytes_received=0, render_mode="HTTP", parse_status="SKIPPED",
                              skip_reason="robots_disallow", artifact_id=None)
            if depth == 0:
                outcome.status, outcome.policy_stop = "BLOCKED", "robots_disallow"
                return outcome
            continue

        if outcome.pages_fetched:
            await sleep(delay)
        try:
            result = await fetch(
                client,
                url,
                allowed_registrable=site,
                accepted_types=cfg["accepted"],
                max_bytes=cfg["max_bytes"],
                validator=validator,
            )
        except PolicyStop as stop:
            outcome.status, outcome.policy_stop = "BLOCKED", stop.reason
            await cooldown_domain(conn, job.domain_id)
            await record_page(conn, job_id=job.id, url=url, final_url=None, depth=depth, kind=kind, http_status=None, content_type=None,
                              content_hash=None, duration_ms=0, bytes_received=0, render_mode="HTTP", parse_status="BLOCKED",
                              skip_reason=stop.reason, artifact_id=None)
            return outcome
        except UnsafeUrlError as error:
            outcome.pages_skipped += 1
            if depth == 0:
                outcome.status, outcome.policy_stop = "BLOCKED", f"unsafe_url: {error}"[:200]
                return outcome
            continue
        except httpx.HTTPError as error:
            errors += 1
            if depth == 0:
                return transient(outcome, job, f"{type(error).__name__}: {error}")
            continue

        render_mode = "HTTP"
        body = result.body
        if result.status_code == 200 and body and cfg["playwright"] and render.available() and needs_render(body):
            try:
                rendered_status, html = await render.render(url, allowed_registrable=site, user_agent=settings.crawler_user_agent)
                if rendered_status == 200:
                    body, render_mode = html.encode(), "BROWSER"
            except PolicyStop as stop:
                outcome.status, outcome.policy_stop = "BLOCKED", stop.reason
                return outcome
            except Exception as error:  # rendering is best effort; keep the HTTP body
                log.warning("render failed url=%s error=%s", url, error)

        outcome.pages_fetched += 1
        outcome.bytes += len(body)
        outcome.kinds[kind] = outcome.kinds.get(kind, 0) + 1
        if result.status_code != 200 or not body:
            await record_page(conn, job_id=job.id, url=url, final_url=result.final_url, depth=depth, kind=kind, http_status=result.status_code,
                              content_type=result.content_type, content_hash=None, duration_ms=result.duration_ms, bytes_received=0,
                              render_mode=render_mode, parse_status="SKIPPED", skip_reason=result.skipped or f"http_{result.status_code}", artifact_id=None)
            if depth == 0:
                if result.status_code in TRANSIENT_STATUSES:
                    return transient(outcome, job, f"http_{result.status_code}")
                outcome.status, outcome.error_code = "FAILED", result.skipped or f"http_{result.status_code}"
                return outcome
            errors += 1
            continue

        if depth == 0:
            root_ok = True
            facts["https"] = result.final_url.startswith("https://")

        artifact_id, digest = await save_artifact(
            conn, url=url, final_url=result.final_url, status_code=result.status_code, content_type=result.content_type, body=body,
            render_mode=render_mode,
        )
        page = extract_page(body.decode("utf-8", errors="replace"), result.final_url, region=job.country)
        run_id = await start_extraction_run(conn, artifact_id, EXTRACTOR_VERSION)
        await record_page(conn, job_id=job.id, url=url, final_url=result.final_url, depth=depth, kind=kind, http_status=result.status_code,
                          content_type=result.content_type, content_hash=digest, duration_ms=result.duration_ms, bytes_received=len(body),
                          render_mode=render_mode, parse_status="PARSED", skip_reason=None, artifact_id=artifact_id)

        for candidate in page.candidates:
            candidate_id = await insert_candidate(
                conn, organization_id=job.organization_id, artifact_id=artifact_id, run_id=run_id, company_id=job.company_id,
                crawl_job_id=job.id, page_url=result.final_url, candidate=candidate,
            )
            outcome.candidates += 1
            if not job.company_id:
                continue
            email = normalize_email(candidate.normalized_value) if candidate.kind == "EMAIL" else None
            if email is not None and await is_suppressed(conn, job.organization_id, email.normalized, email.domain):
                await reject_candidate(conn, candidate_id, "suppressed")
                continue
            promote, reason = should_auto_promote(candidate, job.domain, settings.crawler_auto_promote_confidence)
            if reason:
                await reject_candidate(conn, candidate_id, reason)
            elif promote:
                normalized = email
                await promote_candidate(
                    conn, candidate_id=candidate_id, organization_id=job.organization_id, company_id=job.company_id,
                    artifact_id=artifact_id, content_hash=digest, page_url=result.final_url, candidate=candidate,
                    is_role=bool(normalized.is_role_account) if normalized else True,
                    local_part=normalized.local_part if normalized else None,
                    domain=normalized.domain if normalized else None,
                    is_free=bool(normalized.is_free_provider) if normalized else False,
                    is_disposable=bool(normalized.is_disposable) if normalized else False,
                )
                outcome.promoted += 1
        await finish_extraction_run(conn, run_id, len(page.candidates))

        if job.company_id:
            if depth == 0 and page.company_name:
                await record_page_fact(conn, organization_id=job.organization_id, company_id=job.company_id, artifact_id=artifact_id,
                                       page_url=result.final_url, field_name="site_name", value=page.company_name, method="metadata", content_hash=digest)
            for tech in page.technologies:
                if tech not in facts["technologies"]:
                    await record_page_fact(conn, organization_id=job.organization_id, company_id=job.company_id, artifact_id=artifact_id,
                                           page_url=result.final_url, field_name="technology", value=tech, method="heuristic", content_hash=digest)
        facts["language"] = facts["language"] or page.language
        facts["description"] = facts["description"] or (page.description if depth == 0 else None)
        facts["technologies"].update(page.technologies)
        if page.has_shop or page.has_booking:
            facts["technologies"].add("shop")
        facts["social"].update(page.social_profiles)
        facts["contact"] = facts["contact"] or kind == "CONTACT" or bool(page.forms)
        facts["careers"] = facts["careers"] or kind == "CAREERS"

        if depth < job.max_depth:
            ranked = sorted(page.links, key=lambda item: KIND_PRIORITY.get(item[1], 9))
            for link, link_kind in ranked:
                if link.rstrip("/").lower() not in visited and (link_kind != "OTHER" or depth == 0):
                    queue.append((link, depth + 1, link_kind))
            queue = deque(sorted(queue, key=lambda item: (KIND_PRIORITY.get(item[2], 9), item[1])))
        await heartbeat(conn, job.id, outcome.pages_fetched)
        await conn.commit()

    if job.company_id:
        await update_company_after_crawl(
            conn, job.company_id, reachable=root_ok, https=facts["https"], language=facts["language"], description=facts["description"],
            technologies=sorted(facts["technologies"]), social_profiles=sorted(facts["social"]),
            has_contact_page=bool(facts["contact"]), has_careers_page=bool(facts["careers"]),
        )
    await touch_domain(conn, job.domain_id, robots_entry.digest)
    if outcome.status == "SUCCEEDED" and (errors or outcome.pages_skipped or (queue and outcome.pages_fetched >= job.max_pages)):
        outcome.status = "PARTIAL"
        outcome.error_code = "budget_reached" if queue else ("page_errors" if errors else "pages_skipped")
    return outcome


def transient(outcome: CrawlOutcome, job: CrawlJob, message: str) -> CrawlOutcome:
    """Bounded exponential backoff with jitter for network failures; never for policy stops."""
    import random

    if job.attempt_count < job.max_attempts:
        outcome.status = "QUEUED"
        backoff = (2 ** job.attempt_count) * 60 + random.randint(0, 30)
        outcome.retry_at = datetime.now(UTC) + timedelta(seconds=backoff)
        outcome.error_code = "transient_retry"
    else:
        outcome.status = "FAILED"
        outcome.error_code = "transient_exhausted"
    outcome.error_message = message[:500]
    return outcome


async def process_one(conn: AsyncConn, client: httpx.AsyncClient, robots: AsyncRobotsCache, **kwargs: Any) -> bool:
    job = await claim_crawl_job(conn)
    if job is None:
        return False
    started = time.monotonic()
    try:
        outcome = await crawl_job(conn, client, robots, job, **kwargs)
    except Exception as error:  # last-resort guard: never leave a job RUNNING
        await conn.rollback()
        log.exception("crawl crashed job=%s", job.id)
        outcome = transient(CrawlOutcome(status="FAILED"), job, f"crash: {error}")
    await finish_crawl_job(
        conn, job.id, outcome.status, pages_fetched=outcome.pages_fetched, pages_skipped=outcome.pages_skipped,
        bytes_downloaded=outcome.bytes, duration_ms=int((time.monotonic() - started) * 1000),
        metrics={"candidates": outcome.candidates, "promoted": outcome.promoted, "kinds": outcome.kinds, "extractor": EXTRACTOR_VERSION},
        error_code=outcome.error_code, error_message=outcome.error_message, policy_stop_reason=outcome.policy_stop, retry_at=outcome.retry_at,
    )
    if outcome.status == "BLOCKED":
        await pause_project_if_blocked(conn, job.project_id, crawl_settings(job)["stop_after_blocked"])
    await conn.commit()
    log.info(
        "crawl job=%s site=%s status=%s pages=%s candidates=%s promoted=%s reason=%s",
        job.id, job.domain, outcome.status, outcome.pages_fetched, outcome.candidates, outcome.promoted,
        outcome.policy_stop or outcome.error_code,
    )
    return True
