"""SSRF protection.

Every outbound URL — and every redirect destination — must pass
``validate_url``. Validation resolves DNS once, checks every returned address
against the blocked ranges, and returns the pinned IP so the caller connects to
the address it validated (defeating DNS rebinding).
"""

from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlsplit

ALLOWED_SCHEMES = {"http", "https"}
BLOCKED_PORTS = {22, 23, 25, 135, 139, 445, 1433, 3306, 3389, 5432, 6379, 9200, 11211}

METADATA_HOSTS = {
    "metadata",
    "metadata.google.internal",
    "metadata.goog",
    "instance-data",
    "169.254.169.254",
}

_EXTRA_BLOCKED = [
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.0.0.0/24"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("198.18.0.0/15"),
    ipaddress.ip_network("224.0.0.0/4"),
    ipaddress.ip_network("240.0.0.0/4"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
    ipaddress.ip_network("::ffff:0:0/96"),
]


class UnsafeUrlError(ValueError):
    """Raised when a URL must not be fetched."""


class UnresolvableHostError(UnsafeUrlError):
    """The host has no DNS record: the site is gone, not refusing us."""


@dataclass(frozen=True)
class ValidatedUrl:
    url: str
    host: str
    port: int
    pinned_ip: str


def is_blocked_ip(value: str) -> bool:
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return True

    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
        return True
    if ip.is_multicast or ip.is_unspecified:
        return True

    return any(ip in network for network in _EXTRA_BLOCKED)


def _resolve(host: str, port: int) -> list[str]:
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as error:
        raise UnresolvableHostError(f"DNS resolution failed for {host}") from error
    addresses = sorted({str(info[4][0]) for info in infos})
    if not addresses:
        raise UnresolvableHostError(f"DNS returned no addresses for {host}")
    return addresses


def validate_url(url: str, *, allow_nonstandard_port: bool = False) -> ValidatedUrl:
    """Validate a single URL and return a DNS-pinned target."""

    if not url or len(url) > 2048:
        raise UnsafeUrlError("URL is empty or too long")

    parts = urlsplit(url)
    if parts.scheme.lower() not in ALLOWED_SCHEMES:
        raise UnsafeUrlError(f"Scheme not allowed: {parts.scheme}")
    if parts.username or parts.password:
        raise UnsafeUrlError("Credentials in URL are not allowed")
    if not parts.hostname:
        raise UnsafeUrlError("URL has no host")

    host = parts.hostname.lower().rstrip(".")
    if host in METADATA_HOSTS or host.endswith(".localhost") or host == "localhost":
        raise UnsafeUrlError("Local or metadata host blocked")

    try:
        port = parts.port or (443 if parts.scheme.lower() == "https" else 80)
    except ValueError as error:
        raise UnsafeUrlError("Invalid port") from error

    if port in BLOCKED_PORTS and not allow_nonstandard_port:
        raise UnsafeUrlError(f"Port {port} is not allowed")

    # IP literal: validate directly, never trust the string form.
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None

    if literal is not None:
        if is_blocked_ip(str(literal)):
            raise UnsafeUrlError("IP address is in a blocked range")
        return ValidatedUrl(url=url, host=host, port=port, pinned_ip=str(literal))

    addresses = _resolve(host, port)
    for address in addresses:
        if is_blocked_ip(address):
            raise UnsafeUrlError(f"{host} resolves to blocked address {address}")

    return ValidatedUrl(url=url, host=host, port=port, pinned_ip=addresses[0])


def is_safe_url(url: str) -> bool:
    try:
        validate_url(url)
    except UnsafeUrlError:
        return False
    return True
