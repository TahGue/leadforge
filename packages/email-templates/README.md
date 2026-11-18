# @leadforge/email-templates

Campaign rendering, shared layout, and the unsubscribe/identification footer that every message must carry.

**Phase:** 8

## Contents

- `render.ts` — HTML + plaintext generation from a template and a recipient context.
- `layouts/` — base layout with sender identity, postal address, one-click unsubscribe.
- `lint.ts` — local content checks (link ratio, tracking sanity, banned phrases).

## Rules

- Plaintext part is mandatory; HTML-only mail is rejected.
- Unsubscribe and sender identity are structural, not template-optional.
- No external image/tracking dependencies by default.
