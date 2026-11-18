# discovery

Turns an ICP definition or an imported domain list into a prioritised crawl frontier.

**Language:** Python · **Phase:** 3 · **Scales:** horizontally (stateless)

## Contract

- Input: `discovery_project` (criteria, budget) or explicit domain list.
- Output: `crawl_targets` rows (`url`, `url_hash`, `domain_id`, `priority`, `depth`) + `lf:crawl:fetch` messages.
- Adapters implement `search(query, cursor) -> Candidate[]` and `policy()`.

## Rules

- A target requires an approved source (`sources.permitted = true`). No exceptions.
- Discovery produces hints, never facts: no company or contact is created here.
- Budget caps (`max_targets`, `max_pages_per_domain`, `max_depth`) are enforced worker-side.
- Duplicate suppression by canonical URL hash, per project.

## Does not

- Fetch pages (that is `crawler`).
- Decide relevance by LLM alone; adapters are deterministic, AI is optional ranking.
