"""Bounded Playwright rendering for JavaScript-only pages (spec section 11).

Used only when the project allows it, the operator enabled it
(CRAWLER_PLAYWRIGHT_ENABLED) and the HTTP response had no usable content.
Every browser request is checked: same registrable site only, validated URL,
no downloads, images/media/fonts blocked. It never interacts with challenges.
"""

from __future__ import annotations

from typing import Any

from .net import looks_like_challenge, registrable
from .safety import UnsafeUrlError, validate_url

BLOCKED_RESOURCES = {"image", "media", "font"}


def available() -> bool:
    try:
        import playwright.async_api  # noqa: F401
    except ImportError:
        return False
    return True


async def render(url: str, *, allowed_registrable: str, user_agent: str, timeout_ms: int = 20_000) -> tuple[int, str]:
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
        try:
            context = await browser.new_context(user_agent=user_agent, accept_downloads=False, java_script_enabled=True)

            async def guard(route: Any) -> None:
                request = route.request
                target = request.url
                if request.resource_type in BLOCKED_RESOURCES:
                    await route.abort()
                    return
                try:
                    validate_url(target)
                except UnsafeUrlError:
                    await route.abort()
                    return
                from urllib.parse import urlsplit

                if registrable(urlsplit(target).hostname or "") != allowed_registrable:
                    await route.abort()
                    return
                await route.continue_()

            await context.route("**/*", guard)
            page = await context.new_page()
            response = await page.goto(url, wait_until="networkidle", timeout=timeout_ms)
            status = response.status if response else 0
            html = await page.content()
            if looks_like_challenge(html.encode()):
                from .net import PolicyStop

                raise PolicyStop("captcha_or_challenge")
            return status, html
        finally:
            await browser.close()
