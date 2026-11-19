"""Policy-aware async HTTP fetching (spec section 11).

Defences, in order:
  * every URL and every redirect hop goes through ``validate_url`` (scheme,
    credentials, ports, metadata hosts, blocked IP ranges);
  * the transport re-resolves and re-validates at *connection time* and
    connects only to a vetted address (``SafeNetworkBackend``), so a DNS answer
    that changes between validation and connect (rebinding) cannot reach a
    private address;
  * redirects may not leave the approved registrable domain unless allowed;
  * streamed byte limit, content-type allowlist and timeouts.
"""

from __future__ import annotations

import asyncio
import socket
import time
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpcore
import httpx
import tldextract

from .config import settings
from .safety import UnsafeUrlError, is_blocked_ip, validate_url

REDIRECT_STATUSES = {301, 302, 303, 307, 308}
POLICY_STOP_STATUSES = {401, 403, 407, 429, 451}
TRANSIENT_STATUSES = {408, 425, 500, 502, 503, 504}

_extract = tldextract.TLDExtract(suffix_list_urls=(), cache_dir=None, include_psl_private_domains=True)


def registrable(host: str) -> str:
    parts = _extract(host)
    return f"{parts.domain}.{parts.suffix}" if parts.suffix else host


class PolicyStop(Exception):
    """Access refused by the site or its policy. Never retried as a network error."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class SafeNetworkBackend(httpcore.AsyncNetworkBackend):
    """Resolve, validate and connect to an approved IP at connection time."""

    def __init__(self, allow_private_for_tests: Iterable[str] = ()) -> None:
        self._inner = httpcore.AnyIOBackend()
        self._test_hosts = set(allow_private_for_tests)

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,  # noqa: ASYNC109 - httpcore interface
        local_address: str | None = None,
        socket_options: Iterable[Any] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        loop = asyncio.get_running_loop()
        infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        addresses = [str(info[4][0]) for info in infos]
        if host not in self._test_hosts:
            safe = [a for a in addresses if not is_blocked_ip(a)]
            if not safe or len(safe) != len(addresses):
                raise httpcore.ConnectError(f"blocked address for {host}: {addresses}")
            addresses = safe
        last: Exception | None = None
        for address in addresses:
            try:
                return await self._inner.connect_tcp(
                    address, port, timeout=timeout, local_address=local_address, socket_options=socket_options
                )
            except (httpcore.ConnectError, httpcore.ConnectTimeout, OSError) as error:
                last = error
        raise httpcore.ConnectError(str(last) if last else f"cannot connect to {host}")

    async def connect_unix_socket(self, *args: Any, **kwargs: Any) -> httpcore.AsyncNetworkStream:
        raise httpcore.ConnectError("unix sockets are not allowed")

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


def make_client(
    *, timeout: float | None = None, user_agent: str | None = None, test_hosts: Iterable[str] = ()
) -> httpx.AsyncClient:
    pool = httpcore.AsyncConnectionPool(
        network_backend=SafeNetworkBackend(test_hosts), max_connections=50, http2=False, retries=0
    )
    transport = httpx.AsyncHTTPTransport()
    transport._pool = pool  # httpx exposes no public hook for a custom network backend
    return httpx.AsyncClient(
        transport=transport,
        headers={
            "User-Agent": user_agent or settings.crawler_user_agent,
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
            "Accept-Language": "en,sv;q=0.8,de;q=0.7,da;q=0.6,no;q=0.6,fi;q=0.6",
        },
        timeout=httpx.Timeout(timeout or settings.crawler_timeout_seconds),
        follow_redirects=False,
        trust_env=False,
    )


@dataclass
class FetchResult:
    url: str
    final_url: str
    status_code: int
    content_type: str | None
    body: bytes
    duration_ms: int
    redirects: int
    skipped: str | None = None


def _content_allowed(content_type: str, accepted: Iterable[str]) -> bool:
    lowered = content_type.split(";")[0].strip().lower()
    return any(lowered == a.lower() for a in accepted)


async def fetch(
    client: httpx.AsyncClient,
    url: str,
    *,
    allowed_registrable: str | None,
    accepted_types: Iterable[str] = ("text/html", "application/xhtml+xml"),
    max_bytes: int | None = None,
    max_redirects: int | None = None,
    validator: Any = validate_url,
) -> FetchResult:
    """GET one page with validation at every hop. Raises PolicyStop or UnsafeUrlError."""
    started = time.monotonic()
    current = url
    limit = max_bytes or settings.crawler_max_bytes
    hops = max_redirects if max_redirects is not None else settings.crawler_max_redirects
    for redirect in range(hops + 1):
        validator(current)
        host = urlsplit(current).hostname or ""
        if allowed_registrable and registrable(host) != allowed_registrable:
            raise UnsafeUrlError(f"redirect left the approved site: {host}")
        async with client.stream("GET", current) as response:
            status = response.status_code
            if status in REDIRECT_STATUSES:
                location = response.headers.get("location")
                if not location:
                    raise UnsafeUrlError("redirect without location")
                current = urljoin(current, location)
                continue
            if status in POLICY_STOP_STATUSES:
                raise PolicyStop(f"http_{status}")
            content_type = response.headers.get("content-type", "")
            duration = int((time.monotonic() - started) * 1000)
            if status != 200:
                return FetchResult(url, current, status, content_type, b"", duration, redirect)
            if not _content_allowed(content_type or "text/html", accepted_types):
                return FetchResult(url, current, status, content_type, b"", duration, redirect, skipped="content_type")
            declared = response.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > limit:
                return FetchResult(url, current, status, content_type, b"", duration, redirect, skipped="too_large")
            chunks: list[bytes] = []
            size = 0
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > limit:
                    return FetchResult(url, current, status, content_type, b"", duration, redirect, skipped="too_large")
                chunks.append(chunk)
            body = b"".join(chunks)
            if looks_like_challenge(body):
                raise PolicyStop("captcha_or_challenge")
            return FetchResult(url, current, status, content_type, body, int((time.monotonic() - started) * 1000), redirect)
    raise UnsafeUrlError("too many redirects")


# Always a challenge: interstitials from anti-bot services.
_CHALLENGE_MARKERS = (
    b"cf-challenge",
    b"challenge-platform",
    b"captcha-delivery",
    b"verify you are human",
    b"are you a robot",
)
# Only a challenge on a small page: reCAPTCHA/hCaptcha also protect ordinary contact forms.
_WEAK_MARKERS = (b"g-recaptcha", b"h-captcha", b"hcaptcha.com")


def looks_like_challenge(body: bytes) -> bool:
    """Anti-bot challenge or CAPTCHA page. The crawler stops; it never tries to solve it."""
    head = body[:200_000].lower()
    if any(marker in head for marker in _CHALLENGE_MARKERS):
        return True
    return len(body) < 15_000 and any(marker in head for marker in _WEAK_MARKERS)
