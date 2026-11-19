"""robots.txt: a site that cannot be reached is not a site that refused us."""

from __future__ import annotations

import asyncio

import httpx

from leadforge.robots import AsyncRobotsCache


def _cache(handler) -> AsyncRobotsCache:  # type: ignore[no-untyped-def]
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return AsyncRobotsCache(client, user_agent="LeadForgeBot/0.2", validator=lambda url, **_: None)


def test_unreachable_site_is_disallowed_but_flagged_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("name resolution failed", request=request)

    cache = _cache(handler)
    entry = asyncio.run(cache.entry("https://gone.test/"))
    assert entry.unreachable is True
    assert asyncio.run(cache.allowed("https://gone.test/")) is False


def test_server_error_disallows_without_flagging_unreachable() -> None:
    # RFC 9309: a live server that errors on robots.txt means "disallow all" - a refusal, not a dead site.
    cache = _cache(lambda request: httpx.Response(503))
    entry = asyncio.run(cache.entry("https://busy.test/"))
    assert entry.unreachable is False
    assert asyncio.run(cache.allowed("https://busy.test/")) is False


def test_missing_robots_allows_everything() -> None:
    cache = _cache(lambda request: httpx.Response(404))
    assert asyncio.run(cache.allowed("https://open.test/page")) is True


def test_host_without_dns_record_is_unreachable() -> None:
    from leadforge.safety import UnresolvableHostError

    def no_dns(url: str, **_: object) -> None:
        raise UnresolvableHostError("DNS resolution failed for gone.test")

    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200)))
    cache = AsyncRobotsCache(client, user_agent="LeadForgeBot/0.2", validator=no_dns)
    entry = asyncio.run(cache.entry("https://gone.test/"))
    assert entry.unreachable is True
    assert asyncio.run(cache.allowed("https://gone.test/")) is False
