"""Integration: discovery run -> staged records, and crawl job -> pages, evidence, contacts.

Runs against a real PostgreSQL database (migrations applied) and a local HTTP
fixture. Skipped automatically when no database is reachable.
"""

from __future__ import annotations

import asyncio
import http.server
import os
import sys
import threading
import uuid
from collections.abc import Iterator
from typing import Any

import psycopg
import pytest
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from leadforge import crawler, discovery
from leadforge.config import settings
from leadforge.net import make_client
from leadforge.robots import AsyncRobotsCache

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

HOME = b"""<!doctype html><html lang="en"><head><title>Fixture AB</title>
<meta name="description" content="Fixture AB builds test fixtures."></head><body>
<p>Sales: <a href="mailto:sales@fixture.test">sales@fixture.test</a></p>
<p>Call <a href="tel:+46317654321">031-765 43 21</a></p>
<a href="/contact">Contact</a> <a href="/private/">Private</a>
</body></html>"""
CONTACT = b"""<!doctype html><html><body>
<p>General enquiries: info@fixture.test</p>
<form><input type="email" name="email"><textarea name="msg"></textarea></form>
</body></html>"""
ROBOTS = b"User-agent: *\nDisallow: /private/\n"


def _dsn() -> str:
    return os.environ.get("DATABASE_URL", "postgresql://leadforge:leadforge_local@127.0.0.1:5432/leadforge").split("?")[0]


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        routes = {"/": HOME, "/contact": CONTACT, "/robots.txt": ROBOTS}
        body = routes.get(self.path)
        if body is None:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("content-type", "text/plain" if self.path == "/robots.txt" else "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: object) -> None:
        return


@pytest.fixture()
def server() -> Iterator[str]:
    httpd = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_port}/"
    httpd.shutdown()


@pytest.fixture()
def db() -> Iterator[psycopg.Connection[dict[str, Any]]]:
    try:
        conn = psycopg.connect(_dsn(), row_factory=dict_row)
        conn.execute('SELECT 1 FROM "CrawlJob" LIMIT 1')
        conn.rollback()
    except psycopg.OperationalError:
        pytest.skip("database not reachable")
    except psycopg.errors.UndefinedTable:
        pytest.skip("database schema not applied")
    settings.database_url = _dsn()
    yield conn
    conn.close()


def _org(conn: psycopg.Connection[dict[str, Any]]) -> str:
    org_id = f"test-org-{uuid.uuid4().hex[:10]}"
    conn.execute(
        'INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt") VALUES (%s, %s, %s, now(), now())',
        (org_id, "Test Org", org_id),
    )
    return org_id


def _source(conn: psycopg.Connection[dict[str, Any]], org_id: str, *, approved: bool, adapter: str = "domain_list") -> str:
    source_id = uuid.uuid4().hex
    conn.execute(
        """INSERT INTO "Source" (id, "organizationId", name, "sourceType", adapter, permitted, "policyStatus",
               "automatedAccessAllowed", enabled, "createdAt", "updatedAt")
           VALUES (%s, %s, %s, 'IMPORT', %s, %s, %s, %s, true, now(), now())""",
        (source_id, org_id, f"src-{source_id[:6]}", adapter, approved, "APPROVED" if approved else "UNREVIEWED", approved),
    )
    return source_id


def _project(conn: psycopg.Connection[dict[str, Any]], org_id: str) -> str:
    project_id = uuid.uuid4().hex
    conn.execute(
        """INSERT INTO "DiscoveryProject" (id, "organizationId", name, status, "geographicMode", settings, "createdAt", "updatedAt")
           VALUES (%s, %s, 'Integration', 'RUNNING', 'WORLDWIDE', %s, now(), now())""",
        (project_id, org_id, Jsonb({"crawl": {"requestsPerDomainPerMinute": 60}})),
    )
    return project_id


def _run(conn: psycopg.Connection[dict[str, Any]], org_id: str, project_id: str, source_id: str, query: dict[str, Any]) -> str:
    run_id = uuid.uuid4().hex
    conn.execute(
        """INSERT INTO "DiscoveryRun" (id, "organizationId", "projectId", "sourceId", status, query, "createdAt")
           VALUES (%s, %s, %s, %s, 'QUEUED', %s, now())""",
        (run_id, org_id, project_id, source_id, Jsonb(query)),
    )
    return run_id


async def _discover() -> bool:
    conn = await psycopg.AsyncConnection.connect(_dsn(), row_factory=dict_row)
    try:
        return await discovery.process_one(conn)
    finally:
        await conn.close()


def test_discovery_stages_records_and_blocks_unapproved_sources(db: psycopg.Connection[dict[str, Any]]) -> None:
    org_id = _org(db)
    approved = _source(db, org_id, approved=True)
    unapproved = _source(db, org_id, approved=False)
    project_id = _project(db, org_id)
    ok_run = _run(db, org_id, project_id, approved, {"domains": ["alpha.example.com", "beta.example.org", "alpha.example.com"]})
    blocked_run = _run(db, org_id, project_id, unapproved, {"domains": ["gamma.example.net"]})
    db.commit()

    # Process until both of this test's runs are terminal (other queued runs may exist).
    for _ in range(20):
        statuses = {
            r["id"]: r["status"]
            for r in db.execute('SELECT id, status FROM "DiscoveryRun" WHERE id = ANY(%s)', ([ok_run, blocked_run],)).fetchall()
        }
        db.rollback()
        if all(s not in {"QUEUED", "RUNNING"} for s in statuses.values()):
            break
        asyncio.run(_discover())

    ok = db.execute('SELECT status, "candidatesFound" FROM "DiscoveryRun" WHERE id = %s', (ok_run,)).fetchone()
    blocked = db.execute('SELECT status, "policyStopReason" FROM "DiscoveryRun" WHERE id = %s', (blocked_run,)).fetchone()
    staged = db.execute('SELECT "sourceRecordId", status FROM "CompanyCandidate" WHERE "runId" = %s ORDER BY 1', (ok_run,)).fetchall()
    assert ok is not None and ok["status"] == "SUCCEEDED" and ok["candidatesFound"] == 2
    assert [s["sourceRecordId"] for s in staged] == ["example.com", "example.org"]
    assert all(s["status"] == "PENDING" for s in staged)
    assert blocked is not None and blocked["status"] == "BLOCKED" and blocked["policyStopReason"] == "source_policy_unreviewed"
    assert db.execute('SELECT count(*) AS n FROM "CompanyCandidate" WHERE "runId" = %s', (blocked_run,)).fetchone()["n"] == 0  # type: ignore[index]


async def _crawl_once() -> bool:
    conn = await psycopg.AsyncConnection.connect(_dsn(), row_factory=dict_row)
    async with make_client(test_hosts=["127.0.0.1"]) as client:
        robots = AsyncRobotsCache(client, validator=lambda url, **_: None)
        try:
            return await crawler.process_one(conn, client, robots, validator=lambda url, **_: None, sleep=lambda _s: asyncio.sleep(0))
        finally:
            await conn.close()


def test_crawl_job_writes_pages_evidence_and_contacts(db: psycopg.Connection[dict[str, Any]], server: str, tmp_path: Any) -> None:
    settings.artifact_dir = str(tmp_path)
    settings.crawler_delay_ms = 0
    org_id = _org(db)
    company_id = uuid.uuid4().hex
    db.execute(
        """INSERT INTO "Company" (id, "organizationId", name, "normalizedName", "countryCode", "createdAt", "updatedAt", tags)
           VALUES (%s, %s, 'Fixture AB', 'fixture', 'SE', now(), now(), '{}')""",
        (company_id, org_id),
    )
    job_id = uuid.uuid4().hex
    db.execute(
        """INSERT INTO "CrawlJob" (id, "organizationId", "companyId", "rootUrl", "urlHash", status, priority, "maxPages", "maxDepth",
               "createdAt", "updatedAt")
           VALUES (%s, %s, %s, %s, %s, 'QUEUED', -1000, 5, 1, now(), now())""",
        (job_id, org_id, company_id, server, uuid.uuid4().hex),
    )
    db.commit()

    for _ in range(10):
        asyncio.run(_crawl_once())
        row = db.execute('SELECT status FROM "CrawlJob" WHERE id = %s', (job_id,)).fetchone()
        db.rollback()
        if row and row["status"] not in {"QUEUED", "RUNNING"}:
            break

    job = db.execute('SELECT status, "pagesFetched", "pagesSkipped", metrics FROM "CrawlJob" WHERE id = %s', (job_id,)).fetchone()
    assert job is not None
    assert job["status"] in {"SUCCEEDED", "PARTIAL"}
    assert job["pagesFetched"] == 2  # home + contact
    assert job["pagesSkipped"] >= 1  # /private/ is disallowed by robots.txt

    pages = db.execute('SELECT url, "pageKind", "parseStatus", "skipReason" FROM "CrawlPage" WHERE "crawlJobId" = %s', (job_id,)).fetchall()
    assert any(p["skipReason"] == "robots_disallow" for p in pages)
    assert {p["pageKind"] for p in pages if p["parseStatus"] == "PARSED"} == {"HOME", "CONTACT"}

    candidates = db.execute(
        'SELECT id, kind, "normalizedValue", method, status FROM "ExtractionCandidate" WHERE "crawlJobId" = %s', (job_id,)
    ).fetchall()
    by_value = {c["normalizedValue"]: c for c in candidates}
    assert by_value["sales@fixture.test"]["status"] == "PROMOTED"  # mailto, role account
    assert by_value["+46317654321"]["status"] == "PROMOTED"  # tel link
    assert by_value["info@fixture.test"]["status"] == "PENDING"  # plain text -> human review

    contacts = db.execute(
        'SELECT category, "phoneE164", "contactFormUrl", "sourceUrl" FROM "Contact" WHERE "companyId" = %s', (company_id,)
    ).fetchall()
    assert any(c["category"] == "SALES" for c in contacts)
    assert any(c["phoneE164"] == "+46317654321" for c in contacts)
    assert any(c["contactFormUrl"] for c in contacts)
    assert all(c["sourceUrl"] for c in contacts)

    evidence = db.execute('SELECT "fieldName", "pageUrl" FROM "SourceEvidence" WHERE "companyId" = %s', (company_id,)).fetchall()
    assert {"email", "phone", "contact_form_url"} <= {e["fieldName"] for e in evidence}

    company = db.execute('SELECT "websiteStatus", description, "hasContactPage" FROM "Company" WHERE id = %s', (company_id,)).fetchone()
    assert company is not None and company["websiteStatus"] == "REACHABLE"
    assert company["hasContactPage"] is True
    assert company["description"] == "Fixture AB builds test fixtures."

    # Gate G5: the database refuses a promoted candidate that has lost its source page.
    db.commit()
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute('UPDATE "ExtractionCandidate" SET "pageUrl" = NULL WHERE id = %s', (by_value["sales@fixture.test"]["id"],))
    db.rollback()


def test_crawl_of_a_suppressed_domain_is_cancelled_without_fetching(db: psycopg.Connection[dict[str, Any]], server: str) -> None:
    org_id = _org(db)
    db.execute(
        """INSERT INTO "SuppressionEntry" (id, "organizationId", "emailNormalized", domain, reason, "createdAt")
           VALUES (%s, %s, '*@127.0.0.1', '127.0.0.1', 'LEGAL_OBJECTION', now())""",
        (uuid.uuid4().hex, org_id),
    )
    job_id = uuid.uuid4().hex
    db.execute(
        """INSERT INTO "CrawlJob" (id, "organizationId", "rootUrl", "urlHash", status, priority, "createdAt", "updatedAt")
           VALUES (%s, %s, %s, %s, 'QUEUED', -2000, now(), now())""",
        (job_id, org_id, server, uuid.uuid4().hex),
    )
    db.commit()
    for _ in range(10):
        asyncio.run(_crawl_once())
        row = db.execute('SELECT status, "errorCode", "pagesFetched" FROM "CrawlJob" WHERE id = %s', (job_id,)).fetchone()
        db.rollback()
        if row and row["status"] not in {"QUEUED", "RUNNING"}:
            break
    assert row is not None
    assert row["status"] == "CANCELLED" and row["errorCode"] == "domain_suppressed" and row["pagesFetched"] == 0
