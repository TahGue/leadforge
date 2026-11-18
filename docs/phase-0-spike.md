# Phase 0 spike — measure extraction yield on real sites

Spec Phase 0 and REALIGNMENT-PLAN R2. The goal is to learn, before scaling, whether public company websites give usable business contacts at a useful rate and precision.

## 1. Choose the sample (a person's decision)

- 50 real company domains across at least 3 countries and several sectors, in your target market (for example Sweden, Norway, Germany).
- Mix of site types: small-business sites, WordPress, shop platforms, larger corporates, and sites likely to be JavaScript-rendered.
- Only companies you have a legitimate reason to research; no personal sites.

Write them to `tests/fixtures/phase0-domains.txt`, one per line (`#` comments allowed). The example file shows the format.

## 2. Run

```bash
export CRAWLER_USER_AGENT="LeadForgeResearchBot/0.2 (+https://your-domain.example/crawler-policy)"
python -m leadforge.spike tests/fixtures/phase0-domains.txt --out reports/phase0 --max-pages 4 --delay 3
```

The spike uses the production crawler's network layer: SSRF guard, robots.txt, policy stops, byte limits. It needs no database. Output:

- `reports/phase0/summary.md`: yield tables and the exit-criteria checklist
- `reports/phase0/results.csv`: one row per extracted value, with page, method, category and snippet

## 3. Label

Open `results.csv`. For at least 25 email rows, set `label_correct` to `y` or `n` by checking the rendered page (not the extractor's output). An email is correct if the page shows it as a contact address of that company.

```bash
python -m leadforge.evaluate --spike reports/phase0/results.csv
```

Add 10 to 20 of the labelled pages to the golden set (`tests/golden/pages` and `labels`, format in `tests/golden/README.md`), so CI guards precision from then on.

## 4. Exit criteria

- No enforcement block or complaint during the run.
- At least 15 companies with a usable business email.
- Hand-checked precision of at least 85% on a sample of 25 or more emails.
- No SSRF or robots violation (covered by `tests/test_net.py` and the crawler tests).

Record the outcome in `docs/phase-0-findings.md`: the summary table, precision, notable failure modes, and the go/no-go decision. If yield is poor, move toward registry and dataset sources (`open_dataset` adapter) before investing in more crawling.
