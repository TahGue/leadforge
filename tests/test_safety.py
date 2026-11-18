import pytest

from leadforge.safety import UnsafeUrlError, is_blocked_ip, is_safe_url, validate_url


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "file:///etc/passwd",
        "ftp://example.com/file",
        "gopher://example.com",
        "http://localhost/",
        "http://localhost./",
        "http://127.0.0.1/",
        "http://127.1.2.3/",
        "http://0.0.0.0/",
        "http://10.0.0.5/",
        "http://172.16.4.4/",
        "http://192.168.1.10/",
        "http://169.254.169.254/latest/meta-data/",
        "http://metadata.google.internal/computeMetadata/v1/",
        "http://[::1]/",
        "http://[fd00::1]/",
        "http://user:pass@example.com/",
        "http://example.com:22/",
        "https://example.com:5432/",
    ],
)
def test_blocks_dangerous_urls(url: str) -> None:
    assert is_safe_url(url) is False
    with pytest.raises(UnsafeUrlError):
        validate_url(url)


def test_allows_public_literal_ip() -> None:
    validated = validate_url("https://93.184.216.34/contact")
    assert validated.host == "93.184.216.34"
    assert validated.pinned_ip == "93.184.216.34"


def test_parses_default_port() -> None:
    validated = validate_url("http://93.184.216.34/contact")
    assert validated.port == 80


@pytest.mark.parametrize(
    "address",
    ["10.1.2.3", "192.168.0.1", "172.20.0.1", "127.0.0.1", "169.254.169.254", "::1", "fe80::1", "fd12::1"],
)
def test_blocked_ranges(address: str) -> None:
    assert is_blocked_ip(address) is True


@pytest.mark.parametrize("address", ["93.184.216.34", "8.8.8.8", "1.1.1.1"])
def test_public_ranges(address: str) -> None:
    assert is_blocked_ip(address) is False
