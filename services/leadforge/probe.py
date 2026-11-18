"""CLI probe used by the Phase 0 spike and for debugging extraction."""

from __future__ import annotations

import argparse
import json

import httpx

from .extract import extract_page
from .safety import validate_url


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch one URL safely and print extraction.")
    parser.add_argument("url")
    parser.add_argument("--no-robots", action="store_true", help="skip robots enforcement")
    args = parser.parse_args()

    validated = validate_url(args.url)
    print(f"validated host={validated.host} ip={validated.pinned_ip}", flush=True)

    with httpx.Client(
        headers={"User-Agent": "LeadForgeBot/0.1 (+https://localhost/bot)"},
        timeout=20.0,
        follow_redirects=True,
        trust_env=False,
    ) as client:
        response = client.get(args.url)
        response.raise_for_status()
        page = extract_page(response.text, str(response.url))

    output = {
        "url": args.url,
        "final_url": str(response.url),
        "status": response.status_code,
        "company_name": page.company_name,
        "contact_links": page.contact_links[:10],
        "emails": [
            {
                "value": candidate.normalized_value,
                "method": candidate.method,
                "confidence": candidate.confidence,
            }
            for candidate in page.emails
        ],
    }
    print(json.dumps(output, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
