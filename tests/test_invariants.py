"""Repository-wide invariants that are cheaper to check by reading the source.

* Gate G6: verification never probes mailboxes (no RCPT/VRFY/EXPN, no SMTP client in Python).
* Spec 26: crawler logs carry no credentials, and keep tracebacks.
"""

from __future__ import annotations

import json
import logging
import re
import sys
from pathlib import Path

from leadforge.worker import JsonFormatter, redact_secrets

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIRS = ["services/leadforge", "apps/web/src", "apps/worker/src", "packages/pipeline/src", "packages/shared/src", "packages/database/src"]
PROBE = re.compile(r"RCPT\s+TO|\bVRFY\b|\bEXPN\b|\bsmtplib\b|aiosmtplib|smtp-connection", re.IGNORECASE)


def _sources() -> list[Path]:
    files: list[Path] = []
    for directory in SOURCE_DIRS:
        for path in (ROOT / directory).rglob("*"):
            if path.suffix in {".py", ".ts", ".tsx", ".mjs"} and "node_modules" not in path.parts and ".test." not in path.name:
                files.append(path)
    return files


def test_source_tree_is_scanned() -> None:
    assert len(_sources()) > 50


def test_no_mailbox_probing_anywhere() -> None:
    hits = [f"{p.relative_to(ROOT)}: {m.group(0)}" for p in _sources() for m in [PROBE.search(p.read_text(encoding="utf-8", errors="ignore"))] if m]
    assert hits == []


def test_log_redaction() -> None:
    text = "connect postgresql://leadforge:s3cret@postgres:5432/db failed; Authorization: Bearer abc.def"
    out = redact_secrets(text)
    assert "s3cret" not in out and "abc.def" not in out
    assert "postgresql://leadforge:***@postgres:5432/db" in out
    assert redact_secrets("https://example.com/contact") == "https://example.com/contact"


def test_json_formatter_redacts_and_keeps_tracebacks() -> None:
    try:
        raise RuntimeError("redis://:hunter2@redis:6379 unreachable")
    except RuntimeError:
        record = logging.LogRecord("leadforge.crawler", logging.ERROR, __file__, 1, "crawl crashed url=%s", ("http://u:pw@x.test/",), sys.exc_info())
    entry = json.loads(JsonFormatter().format(record))
    assert entry["message"] == "crawl crashed url=http://u:***@x.test/"
    assert "RuntimeError" in entry["exception"]
    assert "hunter2" not in entry["exception"]
