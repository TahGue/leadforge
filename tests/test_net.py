"""Connection-time SSRF / DNS-rebinding defences and policy-stop handling."""

from __future__ import annotations

import asyncio
import socket

import httpcore
import httpx
import pytest

from leadforge import net
from leadforge.net import PolicyStop, SafeNetworkBackend, fetch, looks_like_challenge, registrable
from leadforge.safety import UnsafeUrlError


def test_registrable_domain() -> None:
    assert registrable("shop.example.co.uk") == "example.co.uk"
    assert registrable("www.acme.se") == "acme.se"


def test_backend_refuses_private_address_at_connect_time(monkeypatch: pytest.MonkeyPatch) -> None:
    """Even if validation passed earlier, a rebinding answer to 127.0.0.1 is refused at connect."""

    async def fake_getaddrinfo(host: str, port: int, **kwargs: object) -> list[tuple[object, ...]]:
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", port))]

    backend = SafeNetworkBackend()

    async def run() -> None:
        loop = asyncio.get_running_loop()
        monkeypatch.setattr(loop, "getaddrinfo", fake_getaddrinfo)
        with pytest.raises(httpcore.ConnectError):
            await backend.connect_tcp("rebind.example", 80)

    asyncio.run(run())


def test_backend_refuses_mixed_public_and_private_answers(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_getaddrinfo(host: str, port: int, **kwargs: object) -> list[tuple[object, ...]]:
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("169.254.169.254", port)),
        ]

    backend = SafeNetworkBackend()

    async def run() -> None:
        loop = asyncio.get_running_loop()
        monkeypatch.setattr(loop, "getaddrinfo", fake_getaddrinfo)
        with pytest.raises(httpcore.ConnectError):
            await backend.connect_tcp("mixed.example", 80)

    asyncio.run(run())


def test_backend_refuses_unix_sockets() -> None:
    async def run() -> None:
        with pytest.raises(httpcore.ConnectError):
            await SafeNetworkBackend().connect_unix_socket("/var/run/docker.sock")

    asyncio.run(run())


def _client(handler: object) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=False)  # type: ignore[arg-type]


def _allow(url: str, **kwargs: object) -> None:
    return None


def test_redirect_to_private_ip_is_blocked() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data/"})

    async def run() -> None:
        async with _client(handler) as client:
            with pytest.raises(UnsafeUrlError):
                await fetch(client, "https://acme.se/", allowed_registrable="acme.se", validator=net.validate_url if False else _strict)

    def _strict(url: str, **kwargs: object) -> None:
        if "169.254" in url:
            raise UnsafeUrlError("blocked")

    asyncio.run(run())


def test_redirect_off_site_is_blocked() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "acme.se":
            return httpx.Response(301, headers={"location": "https://evil.example/"})
        return httpx.Response(200, text="<html></html>", headers={"content-type": "text/html"})

    async def run() -> None:
        async with _client(handler) as client:
            with pytest.raises(UnsafeUrlError):
                await fetch(client, "https://acme.se/", allowed_registrable="acme.se", validator=_allow)

    asyncio.run(run())


@pytest.mark.parametrize("status", [401, 403, 429])
def test_access_denied_is_a_policy_stop(status: int) -> None:
    async def run() -> None:
        async with _client(lambda request: httpx.Response(status)) as client:
            with pytest.raises(PolicyStop) as stop:
                await fetch(client, "https://acme.se/", allowed_registrable="acme.se", validator=_allow)
            assert stop.value.reason == f"http_{status}"

    asyncio.run(run())


def test_oversized_response_is_skipped() -> None:
    body = b"<html>" + b"x" * 5000 + b"</html>"

    async def run() -> None:
        async with _client(lambda r: httpx.Response(200, content=body, headers={"content-type": "text/html"})) as client:
            result = await fetch(client, "https://acme.se/", allowed_registrable="acme.se", max_bytes=1000, validator=_allow)
            assert result.skipped == "too_large"
            assert result.body == b""

    asyncio.run(run())


def test_non_html_content_is_skipped() -> None:
    async def run() -> None:
        async with _client(lambda r: httpx.Response(200, content=b"%PDF", headers={"content-type": "application/pdf"})) as client:
            result = await fetch(client, "https://acme.se/x.pdf", allowed_registrable="acme.se", validator=_allow)
            assert result.skipped == "content_type"

    asyncio.run(run())


def test_challenge_page_stops_crawl() -> None:
    page = b"<html><body><div id='cf-challenge'>Checking your browser</div></body></html>"

    async def run() -> None:
        async with _client(lambda r: httpx.Response(200, content=page, headers={"content-type": "text/html"})) as client:
            with pytest.raises(PolicyStop):
                await fetch(client, "https://acme.se/", allowed_registrable="acme.se", validator=_allow)

    asyncio.run(run())


def test_recaptcha_on_a_normal_contact_page_is_not_a_challenge() -> None:
    page = b"<html><body>" + b"<p>Contact our sales team.</p>" * 800 + b"<div class='g-recaptcha'></div></body></html>"
    assert not looks_like_challenge(page)
    assert looks_like_challenge(b"<html><div class='g-recaptcha'></div></html>")
