"""Integration test: crawl target -> fetch -> extract -> candidate rows.

Runs against a real PostgreSQL-compatible database and a local HTTP fixture.
Skipped automatically when no database is reachable.
"""

from __future__ import annotations

import http.server
import threading
import uuid

import psycopg
import pytest
from psycopg.rows import dict_row

from leadforge import worker
from leadforge.config import settings
from leadforge.safety import ValidatedUrl

FIXTURE = b"""
<!doctype html><html><head><title>Fixture AB</title></head><body>
<p>Contact us at <a href="mailto:hello@fixture.se">hello@fixture.se</a></p>
<p>or sales@fixture.se</p>
<a href="/contact">Contact</a>
</body></html>
"""


def _dsn() -> str:
    import os

    return os.environ.get(
        "DATABASE_URL", "postgresql://leadforge:leadforge_local@127.0.0.1:5432/leadforge"
    ).split("?")[0]


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(FIXTURE)

    def log_message(self, *args: object) -> None:
        return


@pytest.fixture()
def server() -> str:
    httpd = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_port}/"
    httpd.shutdown()


def test_process_one_writes_candidates(server: str, monkeypatch: pytest.MonkeyPatch) -> None:
    try:
        conn = psycopg.connect(_dsn(), row_factory=dict_row)
    except psycopg.OperationalError:
        pytest.skip("database not reachable")

    settings.database_url = _dsn()
    settings.crawler_delay_ms = 1

    # The fixture server is loopback, which the real guard blocks by design.
    monkeypatch.setattr(
        worker,
        "validate_url",
        lambda url, **kwargs: ValidatedUrl(url=url, host="127.0.0.1", port=80, pinned_ip="127.0.0.1"),
    )
    monkeypatch.setattr(worker.RobotsCache, "allowed", lambda self, url: True)
    monkeypatch.setattr(worker.RobotsCache, "raw_for", lambda self, url: None)

    org_id = f"test-org-{uuid.uuid4()}"
    domain_id = f"test-domain-{uuid.uuid4()}"
    company_id = f"test-company-{uuid.uuid4()}"
    target_id = f"test-target-{uuid.uuid4()}"
    project_id = f"test-project-{uuid.uuid4()}"
    slug = f"org-{uuid.uuid4().hex[:8]}"

    conn.execute(
        'INSERT INTO "Organization" (id, name, slug, "updatedAt") VALUES (%s, %s, %s, now())',
        (org_id, "Test Org", slug),
    )
    conn.execute(
        'INSERT INTO "Domain" (id, domain, "registrableDomain", tld, "updatedAt") VALUES (%s, %s, %s, %s, now())',
        (domain_id, f"{uuid.uuid4().hex}.test", "fixture.test", "test"),
    )
    conn.execute(
        'INSERT INTO "Company" (id, "organizationId", name, "updatedAt") VALUES (%s, %s, %s, now())',
        (company_id, org_id, "Fixture AB"),
    )
    conn.execute(
        'INSERT INTO "CompanyDomain" ("companyId", "domainId", "isPrimary") VALUES (%s, %s, true)',
        (company_id, domain_id),
    )
    conn.execute(
        'INSERT INTO "DiscoveryProject" (id, "organizationId", name, "updatedAt") VALUES (%s, %s, %s, now())',
        (project_id, org_id, "Fixture project"),
    )
    conn.execute(
        """
        INSERT INTO "CrawlTarget"
            (id, "organizationId", "projectId", "domainId", url, "urlHash", priority, depth,
             status, "scheduledFor", "createdAt", "updatedAt")
        VALUES (%s, %s, %s, %s, %s, %s, 100, 0, 'QUEUED', now(), now(), now())
        """,
        (target_id, org_id, project_id, domain_id, server, uuid.uuid4().hex),
    )
    conn.commit()

    import httpx

    robots = worker.RobotsCache(httpx.Client())
    with httpx.Client(trust_env=False) as client:
        worked = worker.process_one(conn, client, robots)
    assert worked is True

    row = conn.execute(
        'SELECT status, attempts FROM "CrawlTarget" WHERE id = %s', (target_id,)
    ).fetchone()
    assert row["status"] == "DONE"

    candidates = conn.execute(
        'SELECT "normalizedValue", method FROM "ExtractionCandidate" WHERE "organizationId" = %s',
        (org_id,),
    ).fetchall()
    values = {candidate["normalizedValue"] for candidate in candidates}
    assert "hello@fixture.se" in values
    assert "sales@fixture.se" in values
    assert any(candidate["method"] == "mailto" for candidate in candidates)

    artifacts = conn.execute(
        'SELECT count(*) AS n FROM "FetchArtifact" WHERE url LIKE %s', (server + "%",)
    ).fetchone()
    assert artifacts["n"] >= 1

    # Cleanup fixture rows (order matters for foreign keys).
    conn.execute('DELETE FROM "ExtractionCandidate" WHERE "organizationId" = %s', (org_id,))
    conn.execute('DELETE FROM "ExtractionRun"')
    conn.execute('DELETE FROM "FetchArtifact" WHERE url LIKE %s', (server + "%",))
    conn.execute('DELETE FROM "CrawlTarget" WHERE "organizationId" = %s', (org_id,))
    conn.execute('DELETE FROM "DiscoveryProject" WHERE "organizationId" = %s', (org_id,))
    conn.execute('DELETE FROM "CompanyDomain" WHERE "companyId" = %s', (company_id,))
    conn.execute('DELETE FROM "Company" WHERE "organizationId" = %s', (org_id,))
    conn.execute('DELETE FROM "CompanyDomain" WHERE "domainId" = %s', (domain_id,))
    conn.execute('DELETE FROM "Domain" WHERE id = %s', (domain_id,))
    conn.execute('DELETE FROM "Organization" WHERE id = %s', (org_id,))
    conn.commit()
    conn.close()
