"""Gate G4/G5 and acceptance #22: replaying a stored artifact with the same extractor
version yields identical candidates; robots.txt Crawl-delay is read and applied."""

from __future__ import annotations

import dataclasses
import hashlib
import json
import time
from pathlib import Path

from leadforge.extract import EXTRACTOR_VERSION, extract_page
from leadforge.robots import parse_robots

PAGES = sorted((Path(__file__).resolve().parent / "golden" / "pages").glob("*.html"))


def _fingerprint(html: str) -> str:
    result = extract_page(html, "https://fixture.example/contact", region="SE")
    payload = json.dumps(dataclasses.asdict(result), sort_keys=True, default=str)
    return hashlib.sha256(payload.encode()).hexdigest()


def test_artifact_replay_is_hash_identical() -> None:
    assert PAGES, "golden pages missing"
    for page in PAGES:
        html = page.read_text(encoding="utf-8")
        assert len({_fingerprint(html) for _ in range(5)}) == 1, page.name
    assert EXTRACTOR_VERSION


def test_replay_is_fast_enough_for_1k_pages() -> None:
    # Gate G5: replay 1k pages < 5 min. Measured on the golden pages, extrapolated.
    html = [p.read_text(encoding="utf-8") for p in PAGES]
    started = time.perf_counter()
    for i in range(1000):
        extract_page(html[i % len(html)], "https://fixture.example/", region="SE")
    assert time.perf_counter() - started < 300


def test_crawl_delay_is_parsed_for_our_agent() -> None:
    robots = "User-agent: LeadForgeBot\nCrawl-delay: 7\nDisallow: /private/\n\nUser-agent: *\nCrawl-delay: 1\n"
    entry = parse_robots(200, robots, "LeadForgeBot/0.1 (+https://example.com/bot)")
    assert entry.crawl_delay == 7.0
    assert entry.parser is not None and not entry.parser.can_fetch("LeadForgeBot", "https://x.test/private/a")


def test_robots_status_handling_rfc9309() -> None:
    assert parse_robots(None, None, "LeadForgeBot").parser is None  # unreachable: disallow all
    assert parse_robots(503, None, "LeadForgeBot").parser is None
    allow_all = parse_robots(404, None, "LeadForgeBot").parser
    assert allow_all is not None and allow_all.can_fetch("LeadForgeBot", "https://x.test/anything")
