# verifier

Establishes how much is actually known about an email address.

**Language:** Python (dnspython, email-validator) · **Phase:** 6 · **Scales:** horizontally

## Contract

- Input: `lf:verify:email` (`email_id`, `method_set`).
- Output: `email_verifications` rows (append-only) and derived `email_addresses.status`.

## Status lattice

`DISCOVERED → SYNTAX_VALID → DNS_VALID → MX_VALID → DELIVERABILITY_UNKNOWN`, plus `UNDELIVERABLE`, `RISKY`, `SUPPRESSED`.

## Rules

- **No SMTP probing.** MX proves the domain accepts mail, not that a mailbox exists.
- Normalise IDN domains to punycode, lowercase domains, strip tracking params from mailto.
- Cache DNS with TTL; respect resolver failures as `UNKNOWN`, never as failure.
- Freshness: MX re-check every 90 days; stale status blocks sending.
- `pattern_inferred` addresses are always `RISKY` until corroborated by evidence.

## Does not

- Decide send eligibility (that is the compliance engine).
- Guess inbox existence or scrape verification APIs.
