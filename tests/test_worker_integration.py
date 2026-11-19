"""Integration: discovery run -> staged records, and crawl job -> pages, evidence, contacts.

Runs against a real PostgreSQL database (migrations applied) and a local HTTP
fixture. Skipped automatically when no database is reachable.
"""

from __future__ import annotations

import asyncio
import contextlib
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


def test_discovery_heartbeat_keeps_a_long_run_alive(db: psycopg.Connection[dict[str, Any]]) -> None:
    org_id = _org(db)
    project_id = _project(db, org_id)
    source_id = _source(db, org_id, approved=True)
    live = _run(db, org_id, project_id, source_id, {})
    done = _run(db, org_id, project_id, _source(db, org_id, approved=True), {})  # one run per project and source
    db.execute(
        """UPDATE "DiscoveryRun" SET status = (CASE WHEN id = %s THEN 'RUNNING' ELSE 'SUCCEEDED' END)::"RunJobStatus",
               "startedAt" = now() - interval '2 hours' WHERE id = ANY(%s)""",
        (live, [live, done]),
    )
    db.commit()

    async def beat_briefly(run_id: str) -> None:
        task = asyncio.create_task(discovery.heartbeat(run_id, every=0.05))
        await asyncio.sleep(0.5)
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    asyncio.run(beat_briefly(live))
    asyncio.run(beat_briefly(done))
    rows = {r["id"]: r for r in db.execute('SELECT id, "heartbeatAt" FROM "DiscoveryRun" WHERE id = ANY(%s)', ([live, done],)).fetchall()}
    db.rollback()
    assert rows[live]["heartbeatAt"] is not None  # recovery now sees it as alive despite the old startedAt
    assert rows[done]["heartbeatAt"] is None  # a finished run is never touched


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


def test_ai_classification_reads_the_company_industry_label(db: psycopg.Connection[dict[str, Any]]) -> None:
    from leadforge.ai import companies_to_classify, company_text

    org_id = _org(db)
    company_id = uuid.uuid4().hex
    db.execute(
        """INSERT INTO "Company" (id, "organizationId", name, "normalizedName", description, industry, "createdAt", "updatedAt")
           VALUES (%s, %s, 'Frantoio Prova', 'frantoio prova', %s, 'craft=oil_mill', now(), now())""",
        (company_id, org_id, "Frantoio Prova presses extra virgin olive oil from local groves."),
    )
    db.commit()

    async def pick() -> list[dict[str, Any]]:
        conn = await psycopg.AsyncConnection.connect(_dsn(), row_factory=dict_row)
        try:
            return await companies_to_classify(conn, 10_000)
        finally:
            await conn.close()

    try:
        row = next(r for r in asyncio.run(pick()) if r["id"] == company_id)
        assert row["industryLabel"] == "craft=oil_mill"
        assert "craft=oil_mill" in company_text(row)
    finally:
        db.execute('DELETE FROM "Organization" WHERE id = %s', (org_id,))
        db.commit()


def test_project_pauses_only_when_refusals_are_the_norm(db: psycopg.Connection[dict[str, Any]]) -> None:
    from leadforge.store import pause_project_if_blocked

    org_id = _org(db)
    project_id = _project(db, org_id)

    def jobs(status: str, n: int) -> None:
        for _ in range(n):
            url = f"https://{uuid.uuid4().hex[:12]}.test/"
            db.execute(
                """INSERT INTO "CrawlJob" (id, "organizationId", "projectId", "rootUrl", "urlHash", status, "updatedAt")
                   VALUES (%s, %s, %s, %s, %s, %s, now())""",
                (uuid.uuid4().hex, org_id, project_id, url, uuid.uuid4().hex, status),
            )
        db.commit()

    async def check() -> bool:
        conn = await psycopg.AsyncConnection.connect(_dsn(), row_factory=dict_row)
        try:
            paused = await pause_project_if_blocked(conn, project_id, 5)
            await conn.commit()
            return paused
        finally:
            await conn.close()

    def status() -> str:
        row = db.execute('SELECT status FROM "DiscoveryProject" WHERE id = %s', (project_id,)).fetchone()
        db.rollback()
        return str(row["status"]) if row else ""

    try:
        # Many independent sites: a few refuse (403, robots.txt) and are skipped; the project goes on.
        jobs("BLOCKED", 5)
        jobs("PARTIAL", 8)
        jobs("QUEUED", 40)  # unfinished crawls do not count
        assert asyncio.run(check()) is False and status() == "RUNNING"
        # Refusals become the norm: we are probably being blocked, so a person must look.
        jobs("BLOCKED", 4)
        assert asyncio.run(check()) is True and status() == "PAUSED"
    finally:
        db.execute('DELETE FROM "Organization" WHERE id = %s', (org_id,))
        db.commit()


def test_triage_learns_an_organizations_labels_and_classifies_its_pending_companies(
    db: psycopg.Connection[dict[str, Any]], monkeypatch: pytest.MonkeyPatch
) -> None:
    from leadforge import triage

    monkeypatch.setattr(settings, "triage_min_examples", 40)
    monkeypatch.setattr(settings, "triage_min_per_class", 10)
    monkeypatch.setattr(settings, "triage_accept_probability", 0.6)
    org_id = _org(db)
    codes = [r["code"] for r in db.execute('SELECT code FROM "Industry" WHERE code IS NOT NULL ORDER BY code LIMIT 2').fetchall()]
    texts = {
        codes[0]: "Frantoio {n} produce olio extravergine di oliva dalle nostre olive, frantoio a freddo.",
        codes[1]: "Hotel {n} offre camere, colazione, piscina e parcheggio vicino al mare.",
    }

    def company(name: str, description: str) -> str:
        company_id = uuid.uuid4().hex
        db.execute(
            """INSERT INTO "Company" (id, "organizationId", name, "normalizedName", description, "createdAt", "updatedAt")
               VALUES (%s, %s, %s, %s, %s, now(), now())""",
            (company_id, org_id, name, name.lower(), description),
        )
        return company_id

    for code, template in texts.items():
        for n in range(25):
            cid = company(f"{code} {n}", template.format(n=n))
            db.execute(
                """INSERT INTO "CompanyIndustry" (id, "companyId", "industryId", "isPrimary", confidence, method, "createdAt", "updatedAt")
                   SELECT %s, %s, id, true, 0.7, 'AI', now(), now() FROM "Industry" WHERE code = %s""",
                (uuid.uuid4().hex, cid, code),
            )
    pending = company("Frantoio Nuovo", "Frantoio Nuovo produce olio extravergine di oliva, frantoio a freddo dal 1950.")
    db.commit()

    async def run() -> dict[str, int]:
        conn = await psycopg.AsyncConnection.connect(_dsn(), row_factory=dict_row)
        try:
            model = triage.Triage(organizations={org_id})  # never touch other tenants' dev data
            await model.maybe_retrain(conn, force=True)
            assert set(model.models) == {org_id} and model.models[org_id].trained_on == 50
            return await model.run_batch(conn)
        finally:
            await conn.close()

    try:
        stats = asyncio.run(run())
        assert stats["industry"] >= 1
        row = db.execute(
            """SELECT i.code, ci.method, ci.confidence, ci.evidence FROM "CompanyIndustry" ci
               JOIN "Industry" i ON i.id = ci."industryId" WHERE ci."companyId" = %s""",
            (pending,),
        ).fetchone()
        assert row is not None and row["code"] == codes[0] and row["method"] == "MODEL"
        assert row["confidence"] <= triage.MAX_CONFIDENCE
        assert "triage-v1" in row["evidence"]
    finally:
        db.execute('DELETE FROM "Organization" WHERE id = %s', (org_id,))
        db.commit()
