# extractor

Converts a stored page into structured candidates with evidence.

**Language:** Python (Selectolax, lxml, Pydantic) · **Phase:** 5 · **Scales:** horizontally

## Contract

- Input: `lf:extract:page` (`fetch_artifact_id`, `extractor_version`).
- Output: `extraction_runs` + `extraction_candidates` (EMAIL / COMPANY / PERSON), each with method, selector, snippet, confidence.

## Order of methods

`mailto:` → JSON-LD/Schema.org → visible contact block → contact/about/team routing → footer → optional Ollama classification.

## Rules

- Deterministic extraction always runs; AI only classifies, never authors values.
- Reject asset names, placeholder domains, third-party widget addresses, hidden/script/comment content.
- Never promote directly: candidates go to review (v1) or a high-confidence auto-promote path (later).
- Idempotent on `(fetch_artifact_id, extractor_version)`; replay is supported and tested.

## Does not

- Verify emails (that is `verifier`).
- Write `contacts` or `email_addresses` rows.
