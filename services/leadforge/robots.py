"""robots.txt fetching, caching and enforcement."""

from __future__ import annotations

import time
import urllib.robotparser
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

from .config import settings
from .safety import UnsafeUrlError, validate_url

CACHE_TTL_SECONDS = 24 * 60 * 60


@dataclass
class _Entry:
    parser: urllib.robotparser.RobotFileParser | None
    expires_at: float
    raw: str | None


class RobotsCache:
    def __init__(self, client: httpx.Client, user_agent: str | None = None) -> None:
        self._client = client
        self._user_agent = user_agent or settings.crawler_user_agent
        self._cache: dict[str, _Entry] = {}

    def _load(self, scheme: str, host: str) -> _Entry:
        key = f"{scheme}://{host}"
        cached = self._cache.get(key)
        if cached and cached.expires_at > time.time():
            return cached

        robots_url = f"{key}/robots.txt"
        parser = urllib.robotparser.RobotFileParser()
        raw: str | None = None
        parser_ref: urllib.robotparser.RobotFileParser | None

        try:
            validate_url(robots_url)
            response = self._client.get(robots_url, timeout=10.0, follow_redirects=False)
            if response.status_code >= 500:
                # RFC 9309: server errors should be treated as disallow.
                parser_ref = None
            elif response.status_code >= 400:
                parser_ref = urllib.robotparser.RobotFileParser()
                parser_ref.parse([])  # allow all
            else:
                raw = response.text[:500_000]
                parser.parse(raw.splitlines())
                parser_ref = parser
        except (httpx.HTTPError, UnsafeUrlError):
            parser_ref = urllib.robotparser.RobotFileParser()
            parser_ref.parse([])

        entry = _Entry(parser=parser_ref, expires_at=time.time() + CACHE_TTL_SECONDS, raw=raw)
        self._cache[key] = entry
        return entry

    def allowed(self, url: str) -> bool:
        if not settings.crawler_respect_robots:
            return True
        parts = urlsplit(url)
        entry = self._load(parts.scheme.lower(), parts.netloc.lower())
        if entry.parser is None:
            return False
        return entry.parser.can_fetch(self._user_agent, url)

    def raw_for(self, url: str) -> str | None:
        parts = urlsplit(url)
        return self._load(parts.scheme.lower(), parts.netloc.lower()).raw
