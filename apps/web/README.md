# @leadforge/web

The dashboard and the `/api/v1` surface. One Next.js application, two concerns.

**Phase:** 1 (scaffold) → 8 (campaign UI)

## Planned layout

```
src/app/(auth)/login          session
src/app/(app)/dashboard       pipeline health
src/app/(app)/companies       inventory + evidence drawer
src/app/(app)/review          keyboard-first triage queue
src/app/(app)/sources         policy + yield
src/app/(app)/campaigns       builder, preview, approval
src/app/api/v1/**             route handlers
```

## Rules

- Server components by default; client components only for interaction.
- Every route handler validates with Zod and calls `requireOrg` before touching data.
- Cursor pagination only; no client-side tables over 500 rows.
- No raw scraped HTML is ever rendered.

## Status

Not scaffolded yet. Phase 0 is CLI-only on purpose: prove the data engine before building the interface.

Scaffold command for Phase 1:

```bash
pnpm create next-app apps/web --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
```
