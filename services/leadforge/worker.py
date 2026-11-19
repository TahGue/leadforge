"""LeadForge Python worker entry point.

    python -m leadforge.worker                 # all roles
    python -m leadforge.worker --role crawl    # one role: crawl | discovery | classify | retention
    python -m leadforge.worker --once          # one pass of each role, then exit

Roles claim work from Postgres (ADR-0021), so run as many processes as needed.
Crawl concurrency is CRAWLER_GLOBAL_CONCURRENCY jobs at a time; a domain is
never crawled by two jobs at once (enforced in the claim query).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
import signal
import sys
import time
from typing import Any

from . import ai, crawler, discovery, retention
from .config import settings
from .net import make_client
from .robots import AsyncRobotsCache
from .store import connect

_SECRET_PATTERNS = [
    (re.compile(r"([a-z][a-z0-9+.-]*://[^\s:/@]*):[^\s@/]+@", re.IGNORECASE), r"\1:***@"),
    (re.compile(r"\b(bearer\s+)[A-Za-z0-9._~+/=-]+", re.IGNORECASE), r"\1***"),
]


def redact_secrets(text: str) -> str:
    """Strip URL passwords and bearer tokens before logging (spec 26: no secret leakage)."""
    for pattern, replacement in _SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)),
            "level": record.levelname.lower(),
            "service": "crawler",
            "logger": record.name,
            "message": redact_secrets(record.getMessage()),
        }
        if record.exc_info:
            entry["exception"] = redact_secrets(self.formatException(record.exc_info))
        return json.dumps(entry)


def configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)


log = logging.getLogger("leadforge.worker")
stop = asyncio.Event()


async def crawl_loop(slot: int, once: bool) -> None:
    conn = await connect()
    async with make_client() as client:
        robots = AsyncRobotsCache(client)
        try:
            while not stop.is_set():
                worked = await crawler.process_one(conn, client, robots)
                if once:
                    return
                if not worked:
                    await asyncio.wait([asyncio.ensure_future(stop.wait())], timeout=2 + slot)
        finally:
            await conn.close()


async def discovery_loop(once: bool) -> None:
    conn = await connect()
    try:
        while not stop.is_set():
            worked = await discovery.process_one(conn)
            if once:
                return
            if not worked:
                await asyncio.wait([asyncio.ensure_future(stop.wait())], timeout=settings.discovery_poll_seconds)
    finally:
        await conn.close()


async def classify_loop(once: bool) -> None:
    if not settings.ollama_enabled:
        log.info("ollama disabled (OLLAMA_ENABLED=false); classification role idle")
        return
    conn = await connect()
    client = ai.OllamaClient()
    try:
        while not stop.is_set():
            stats = await ai.classify_batch(conn, client)
            if any(stats.values()):
                log.info("classification %s", stats)
            if once:
                return
            await asyncio.wait([asyncio.ensure_future(stop.wait())], timeout=30 if not any(stats.values()) else 1)
    finally:
        await client.close()
        await conn.close()


async def retention_loop(once: bool) -> None:
    conn = await connect()
    try:
        while not stop.is_set():
            purged = await retention.purge_artifacts(conn)
            if purged:
                log.info("artifact retention purged=%s", purged)
            if once:
                return
            await asyncio.wait([asyncio.ensure_future(stop.wait())], timeout=3600 if not purged else 5)
    finally:
        await conn.close()


async def main(role: str, once: bool) -> None:
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:  # Windows
            signal.signal(sig, lambda *_: stop.set())
    log.info("worker start role=%s concurrency=%s ua=%s", role, settings.crawler_global_concurrency, settings.crawler_user_agent)
    tasks: list[Any] = []
    if role in {"all", "crawl"}:
        tasks += [crawl_loop(slot, once) for slot in range(max(1, settings.crawler_global_concurrency))]
    if role in {"all", "discovery"}:
        tasks.append(discovery_loop(once))
    if role in {"all", "classify"}:
        tasks.append(classify_loop(once))
    if role in {"all", "retention"}:
        tasks.append(retention_loop(once))
    await asyncio.gather(*tasks)
    log.info("worker stopped")


def run() -> None:
    parser = argparse.ArgumentParser(description="LeadForge data engine worker")
    parser.add_argument("--role", default="all", choices=["all", "crawl", "discovery", "classify", "retention"])
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    configure_logging()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())  # psycopg async needs a selector loop
    asyncio.run(main(args.role, args.once))


if __name__ == "__main__":
    run()
