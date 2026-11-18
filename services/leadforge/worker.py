"""Crawl + extract worker.

Claims one QUEUED CrawlTarget at a time directly from Postgres, fetches it
politely, extracts candidates, and writes them to the review queue. It never
promotes a record and never decides eligibility.
"""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

import httpx

from .config import settings
from .extract import extract_page
from .robots import RobotsCache
from .safety import UnsafeUrlError, validate_url
from .store import (
    DbConnection,
    claim_target,
    company_for_domain,
    connect,
    cooldown_domain,
    enqueue_contact_pages,
    finish_run,
    insert_candidate,
    mark_target,
    save_artifact,
    touch_domain,
    upsert_run,
)

EXTRACTOR_VERSION = "lf-extract-1"
BLOCKING_STATUSES = {401, 403, 429, 451}


@dataclass
class FetchResult:
    status_code: int
    final_url: str
    content_type: str | None
    body: bytes


def _client() -> httpx.Client:
    return httpx.Client(
        headers={
            "User-Agent": settings.crawler_user_agent,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en,sv;q=0.8,de;q=0.7",
        },
        timeout=httpx.Timeout(settings.crawler_timeout_seconds),
        follow_redirects=False,
        trust_env=False,
    )


def fetch(client: httpx.Client, url: str, robots: RobotsCache) -> FetchResult:
    current = url
    for _ in range(settings.crawler_max_redirects):
        validate_url(current)
        if not robots.allowed(current):
            raise PermissionError("robots_disallow")

        with client.stream("GET", current) as response:
            if response.status_code in {301, 302, 303, 307, 308}:
                location = response.headers.get("location")
                if not location:
                    raise ValueError("redirect without location")
                current = urljoin(current, location)
                continue

            if response.status_code != 200:
                return FetchResult(
                    status_code=response.status_code,
                    final_url=str(response.url),
                    content_type=response.headers.get("content-type"),
                    body=b"",
                )

            content_type = response.headers.get("content-type", "")
            if "html" not in content_type.lower():
                return FetchResult(response.status_code, str(response.url), content_type, b"")

            chunks: list[bytes] = []
            size = 0
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > settings.crawler_max_bytes:
                    raise ValueError("response_too_large")
                chunks.append(chunk)
            return FetchResult(response.status_code, str(response.url), content_type, b"".join(chunks))

    raise ValueError("too_many_redirects")


def process_one(conn: DbConnection, client: httpx.Client, robots: RobotsCache) -> bool:
    target = claim_target(conn)
    if target is None:
        return False

    try:
        cooldown = conn.execute(
            'SELECT "cooldownUntil" FROM "Domain" WHERE id = %s', (target.domain_id,)
        ).fetchone()
        if cooldown and cooldown["cooldownUntil"]:
            mark_target(conn, target.id, "BLOCKED", error="domain_cooldown")
            conn.commit()
            return True

        result = fetch(client, target.url, robots)

        if result.status_code in BLOCKING_STATUSES:
            mark_target(conn, target.id, "BLOCKED", error=f"http_{result.status_code}")
            cooldown_domain(conn, target.domain_id)
            conn.commit()
            return True

        if result.status_code != 200 or not result.body:
            retry = target.attempts < 3
            mark_target(
                conn,
                target.id,
                "QUEUED" if retry else "FAILED",
                error=f"http_{result.status_code}",
                retry=retry,
            )
            conn.commit()
            return True

        artifact_id, digest = save_artifact(
            conn,
            url=target.url,
            final_url=result.final_url,
            status_code=result.status_code,
            content_type=result.content_type,
            body=result.body,
        )

        html = result.body.decode("utf-8", errors="replace")
        page = extract_page(html, result.final_url)
        company = company_for_domain(conn, target.domain_id)

        run_id = upsert_run(conn, artifact_id, EXTRACTOR_VERSION)
        for candidate in page.emails:
            insert_candidate(
                conn,
                organization_id=target.organization_id,
                artifact_id=artifact_id,
                run_id=run_id,
                company_id=company["id"] if company else None,
                candidate=candidate,
            )
        finish_run(conn, run_id, len(page.emails))

        if page.contact_links and company:
            enqueue_contact_pages(
                conn,
                organization_id=target.organization_id,
                project_id=target.project_id,
                domain_id=target.domain_id,
                links=page.contact_links,
                depth=target.depth,
                max_pages=settings.crawler_max_pages_per_company,
            )

        touch_domain(
            conn,
            target.domain_id,
            hashlib.sha256((robots.raw_for(result.final_url) or "").encode()).hexdigest(),
        )
        mark_target(conn, target.id, "DONE")
        conn.commit()

        host = urlsplit(result.final_url).hostname
        print(
            f"crawl {host} status={result.status_code} bytes={len(result.body)} "
            f"candidates={len(page.emails)} sha={digest[:10]}"
        )
        return True

    except PermissionError as error:
        mark_target(conn, target.id, "BLOCKED", error=str(error))
        conn.commit()
        return True
    except UnsafeUrlError as error:
        mark_target(conn, target.id, "BLOCKED", error=f"unsafe_url: {error}")
        conn.commit()
        return True
    except (httpx.HTTPError, ValueError) as error:
        retry = target.attempts < 3
        mark_target(
            conn,
            target.id,
            "QUEUED" if retry else "FAILED",
            error=str(error)[:500],
            retry=retry,
        )
        conn.commit()
        return True


def run() -> None:
    conn = connect()
    robots = RobotsCache(_client())
    idle_sleep = max(1.0, settings.crawler_delay_ms / 1000)

    print(f"leadforge worker started (extractor={EXTRACTOR_VERSION})")
    try:
        with _client() as client:
            while True:
                worked = process_one(conn, client, robots)
                if not worked:
                    time.sleep(idle_sleep * 2)
                else:
                    time.sleep(settings.crawler_delay_ms / 1000)
    except KeyboardInterrupt:
        print("worker stopping")
    finally:
        conn.close()


if __name__ == "__main__":
    run()
