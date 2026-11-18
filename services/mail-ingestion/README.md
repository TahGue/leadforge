# mail-ingestion

Turns delivery failures and complaints into suppression and reputation signals.

**Language:** TypeScript (Node) · **Phase:** 9

## Contract

- Input: DSN bounce messages and ARF complaints piped from Postfix (or read from a mailbox).
- Output: `email_events` (`BOUNCE_HARD`, `BOUNCE_SOFT`, `COMPLAINT`), `suppression_entries`, campaign incident state.

## Rules

- Classify 5.x.x as hard, 4.x.x as soft; parse enhanced status codes before falling back to text.
- Hard bounce and complaint → immediate, permanent suppression.
- Malformed or unparseable messages are quarantined, never silently dropped.
- Body size caps and strict parser limits (untrusted input from the internet).
- Volume anomaly (complaint spike) pauses the campaign and alerts.

## Does not

- Send mail.
- Modify campaign content.
