"""Quality gate G4: 10k-URL fuzz, zero private-IP targets.

Seeded, so failures reproduce. Hosts are IP literals in many notations, or
hostnames whose DNS answer is faked (mixed public/private sets, as in a
rebinding attempt). Invariant: whenever validate_url accepts a URL, the pinned
address and every resolved address are public; and whenever any resolved
address is private, the URL is rejected.
"""

from __future__ import annotations

import ipaddress
import random

import pytest

from leadforge import safety
from leadforge.safety import UnsafeUrlError, is_blocked_ip, validate_url

N = 10_000

PRIVATE_V4 = ["10.0.0.0/8", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "0.0.0.0/8", "198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4"]
PRIVATE_V6 = ["::1/128", "fc00::/7", "fe80::/10"]
PUBLIC_V4 = ["93.184.216.0/24", "8.8.8.0/24", "151.101.0.0/16", "185.199.108.0/22"]
PUBLIC_V6 = ["2606:2800:220::/48", "2a00:1450::/32"]


def _pick(rng: random.Random, cidrs: list[str]) -> str:
    network = ipaddress.ip_network(rng.choice(cidrs))
    return str(network[rng.randrange(network.num_addresses)])


def _address(rng: random.Random, private: bool) -> str:
    if rng.random() < 0.75:
        return _pick(rng, PRIVATE_V4 if private else PUBLIC_V4)
    return _pick(rng, PRIVATE_V6 if private else PUBLIC_V6)


def _literal_host(rng: random.Random, ip: str) -> str:
    parsed = ipaddress.ip_address(ip)
    if parsed.version == 6:
        return f"[{ip}]"
    style = rng.randrange(4)
    if style == 1:
        return f"[::ffff:{ip}]"  # IPv4-mapped IPv6
    if style == 2:
        return ip + "."  # trailing dot
    return ip


def _url(rng: random.Random, host: str) -> str:
    scheme = rng.choice(["http", "https", "HTTP", "HtTpS"])
    port = rng.choice(["", "", ":80", ":443", ":8080"])
    path = rng.choice(["/", "/contact", "/a/../b?x=1", "/%2e%2e/", "#frag"])
    return f"{scheme}://{host}{port}{path}"


@pytest.fixture
def fake_dns(monkeypatch: pytest.MonkeyPatch) -> dict[str, list[str]]:
    answers: dict[str, list[str]] = {}

    def resolve(host: str, port: int) -> list[str]:
        if host not in answers:
            raise UnsafeUrlError(f"DNS resolution failed for {host}")
        return sorted(answers[host])

    monkeypatch.setattr(safety, "_resolve", resolve)
    return answers


def test_fuzz_never_pins_a_private_address(fake_dns: dict[str, list[str]]) -> None:
    rng = random.Random(20261118)
    accepted = rejected_private = 0
    for i in range(N):
        if rng.random() < 0.5:
            ip = _address(rng, private=rng.random() < 0.6)
            url = _url(rng, _literal_host(rng, ip))
            truth = [ip]
        else:
            host = f"h{i}.example{rng.randrange(50)}.com"
            truth = [_address(rng, private=rng.random() < 0.4) for _ in range(rng.randint(1, 3))]
            fake_dns[host] = truth
            url = _url(rng, host)
        any_private = any(is_blocked_ip(a) for a in truth)
        try:
            target = validate_url(url)
        except UnsafeUrlError:
            rejected_private += any_private
            continue
        accepted += 1
        assert not is_blocked_ip(target.pinned_ip), url
        assert not any_private, f"accepted {url} although DNS/literal included a private address {truth}"
    # The generator must exercise both outcomes, or the test proves nothing.
    assert accepted > 1_000
    assert rejected_private > 1_000
