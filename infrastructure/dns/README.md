# DNS

Records and checks for the sending domain. Example zone files live here; real values are injected at deploy time.

## Checklist

- SPF includes every sending source, exactly once, with `-all` once stable.
- DKIM selector published and matching the active key.
- DMARC progressing `p=none` → `p=quarantine` → `p=reject`, with aggregate reporting.
- PTR matches the HELO/EHLO name and forward-resolves to the same IP.
- MTA-STS and TLS reporting when the mail host is stable.

## Never

- Wildcard SPF, `+all`, or a DMARC policy with no reporting address.
- Publishing records for a domain you do not control.
