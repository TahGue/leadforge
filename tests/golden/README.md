# Golden set — extraction quality corpus

The single most important test asset in the project. See [`docs/quality-gates.md`](../../docs/quality-gates.md) §2.

## Structure

```
tests/golden/
  pages/            archived artifacts (html + metadata) or URLs pinned by content hash
  labels/           one YAML per page: expected emails, companies, people, traps
  traps/            adversarial fixtures (assets, widgets, obfuscation, hidden nodes)
  manifest.json     page list, archetype, labeler, date, notes
```

## Label format

```yaml
url: https://example.com/contact
archetype: contact-page
labeler: <name>
labeled_at: 2026-11-18
emails:
  - value: info@example.com
    belongs_to: example.com
    method: mailto
    note: footer
traps:
  - value: logo@2x.png
    reason: asset-filename
  - value: widget@thirdparty.com
    reason: third-party-widget
```

## Rules

- 500 pages across 8 archetypes before Phase 5 exits.
- Every label change needs a second reviewer.
- Precision ≥ 90%, recall ≥ 70%; a regression > 2 points blocks the release.
- Never label from the extractor's own output — label from the rendered page.
