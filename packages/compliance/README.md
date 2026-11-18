# @leadforge/compliance

The eligibility engine: rule interpretation, jurisdiction profiles, decision records.

**Phase:** 7

## Contents

- `engine.ts` — evaluation order from [`docs/compliance.md`](../../docs/compliance.md) §5.2.
- `profiles/` — profile schema + validators (rules are data, not code).
- `decisions.ts` — append-only writes, expiry, supersession.

## Rules

- Default deny. Unknown jurisdiction, missing basis, stale decision, or any suppression → block.
- Decisions are immutable and carry `rule_set_version` + `inputs_hash`.
- No country-specific `if` branches: rules live in versioned JSON profiles (ADR-0009).
- A profile can only be used for sending when `status = APPROVED`.

## Status

Specified; implementation lands in Phase 7. Nothing here may be used to send before legal sign-off.
