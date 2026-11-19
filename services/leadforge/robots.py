"""robots.txt fetching, caching and enforcement (RFC 9309)."""

from __future__ import annotations

import hashlib
import time
import urllib.robotparser
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

from .config import settings
from .safety import UnresolvableHostError, UnsafeUrlError, validate_url

CACHE_TTL_SECONDS = 24 * 60 * 60


@dataclass
class RobotsEntry:
    parser: urllib.robotparser.RobotFileParser | None
    expires_at: float
    raw: str | None
    crawl_delay: float | None
    # The site could not be reached at all (no DNS record, connection refused or timed out).
    # Fetching is still disallowed, but nobody refused us: the site is gone or down.
    unreachable: bool = False

    @property
    def digest(self) -> str | None:
        return hashlib.sha256(self.raw.encode()).hexdigest() if self.raw is not None else None


def parse_robots(status: int | None, text: str | None, user_agent: str) -> RobotsEntry:
    """Status handling per RFC 9309: 4xx = allow all, 5xx/unreachable = disallow all."""
    if status is None or status >= 500:
        return RobotsEntry(None, time.time() + 3600, None, None)
    parser = urllib.robotparser.RobotFileParser()
    if status >= 400 or text is None:
        parser.parse([])
        return RobotsEntry(parser, time.time() + CACHE_TTL_SECONDS, None, None)
    raw = text[:500_000]
    parser.parse(raw.splitlines())
    delay = parser.crawl_delay(user_agent)
    return RobotsEntry(parser, time.time() + CACHE_TTL_SECONDS, raw, float(delay) if delay else None)


class AsyncRobotsCache:
    def __init__(self, client: httpx.AsyncClient, user_agent: str | None = None, validator=validate_url) -> None:  # type: ignore[no-untyped-def]
        self._client = client
        self._user_agent = user_agent or settings.crawler_user_agent
        self._cache: dict[str, RobotsEntry] = {}
        self._validator = validator

    @property
    def agent_token(self) -> str:
        return self._user_agent.split("/")[0]

    async def entry(self, url: str) -> RobotsEntry:
        parts = urlsplit(url)
        key = f"{parts.scheme.lower()}://{parts.netloc.lower()}"
        cached = self._cache.get(key)
        if cached and cached.expires_at > time.time():
            return cached
        robots_url = f"{key}/robots.txt"
        status: int | None
        text: str | None = None
        unreachable = False
        try:
            self._validator(robots_url)
            response = await self._client.get(robots_url, timeout=10.0, follow_redirects=False)
            status = response.status_code
            if status in {301, 302, 303, 307, 308}:
                status, text = 404, None  # do not follow robots redirects off-site; treat as absent
            elif status < 400:
                text = response.text
        except (httpx.ConnectError, httpx.ConnectTimeout, UnresolvableHostError):
            status, unreachable = None, True
        except (httpx.HTTPError, UnsafeUrlError):
            status = None
        entry = parse_robots(status, text, self.agent_token)
        entry.unreachable = unreachable
        self._cache[key] = entry
        return entry

    async def allowed(self, url: str) -> bool:
        if not settings.crawler_respect_robots:
            return True
        entry = await self.entry(url)
        if entry.parser is None:
            return False
        return entry.parser.can_fetch(self.agent_token, url)
