# campaign

Materialises eligible recipients and drives sending, one gated batch at a time.

**Language:** TypeScript (Node) · **Phase:** 8–9 · **Scales:** 1–N with row leases

## Contract

- Input: approved `campaign` + segment snapshot.
- Output: `campaign_recipients` → `campaign_sends` → `email_events`.

## Rules

- Re-evaluate eligibility immediately before each batch and before each send; decisions older than 24h are invalid.
- Ineligible or suppressed recipients are excluded, never "sent anyway".
- Idempotent per `(campaign_id, email_id)`; retries must not duplicate sends.
- Hard caps: frequency limits, per-ISP throttles, warmup state machine.
- Global kill switch halts all sending within one batch.

## Does not

- Build segments or templates (that is the API/domain layer).
- Process bounces (that is `mail-ingestion`).
