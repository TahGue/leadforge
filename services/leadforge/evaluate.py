"""Extraction quality evaluation against hand-labelled pages (spec section 26).

    python -m leadforge.evaluate                       # golden set in tests/golden
    python -m leadforge.evaluate --spike results.csv   # precision of a labelled spike sample

Golden layout: ``tests/golden/pages/<id>.html`` plus ``tests/golden/labels/<id>.json``:

    {"url": "...", "region": "SE", "archetype": "contact-page", "labeler": "...",
     "emails": [{"value": "...", "category": "SALES"}], "phones": ["+46..."],
     "forms": 1, "traps": [{"value": "logo@2x.png", "reason": "asset"}]}

Precision is prioritized over recall (spec 26).
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import dataclass
from pathlib import Path

from .extract import extract_page

DEFAULT_ROOT = Path(__file__).resolve().parents[2] / "tests" / "golden"


@dataclass
class Score:
    tp: int = 0
    fp: int = 0
    fn: int = 0

    @property
    def precision(self) -> float:
        return self.tp / (self.tp + self.fp) if self.tp + self.fp else 1.0

    @property
    def recall(self) -> float:
        return self.tp / (self.tp + self.fn) if self.tp + self.fn else 1.0


@dataclass
class Report:
    pages: int
    emails: Score
    phones: Score
    categories_correct: int
    categories_total: int
    traps_hit: list[str]

    @property
    def category_accuracy(self) -> float:
        return self.categories_correct / self.categories_total if self.categories_total else 1.0


def evaluate(root: Path = DEFAULT_ROOT) -> Report:
    emails, phones = Score(), Score()
    cat_ok = cat_total = pages = 0
    traps_hit: list[str] = []
    for label_path in sorted((root / "labels").glob("*.json")):
        label = json.loads(label_path.read_text(encoding="utf-8"))
        html = (root / "pages" / f"{label_path.stem}.html").read_text(encoding="utf-8")
        page = extract_page(html, label["url"], region=label.get("region"))
        pages += 1
        found_emails = {c.normalized_value: c for c in page.emails}
        expected_emails = {e["value"].lower(): e for e in label.get("emails", [])}
        emails.tp += len(found_emails.keys() & expected_emails.keys())
        emails.fp += len(found_emails.keys() - expected_emails.keys())
        emails.fn += len(expected_emails.keys() - found_emails.keys())
        for value, expected in expected_emails.items():
            if "category" in expected and value in found_emails:
                cat_total += 1
                cat_ok += int(found_emails[value].category == expected["category"])
        found_phones = {c.normalized_value for c in page.phones}
        expected_phones = set(label.get("phones", []))
        phones.tp += len(found_phones & expected_phones)
        phones.fp += len(found_phones - expected_phones)
        phones.fn += len(expected_phones - found_phones)
        trap_values = {t["value"].lower() for t in label.get("traps", [])}
        traps_hit += [f"{label_path.stem}:{v}" for v in trap_values & (found_emails.keys() | found_phones)]
    return Report(pages, emails, phones, cat_ok, cat_total, traps_hit)


def spike_precision(path: Path) -> tuple[int, int]:
    """Count labelled rows (label_correct = y/n) in a spike results.csv."""
    correct = labelled = 0
    with path.open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            mark = (row.get("label_correct") or "").strip().lower()
            if mark in {"y", "yes", "1", "true"}:
                correct += 1
                labelled += 1
            elif mark in {"n", "no", "0", "false"}:
                labelled += 1
    return correct, labelled


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate extraction against labelled pages")
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--spike", type=Path, help="labelled spike results.csv")
    parser.add_argument("--min-precision", type=float, default=0.9)
    parser.add_argument("--min-recall", type=float, default=0.7)
    args = parser.parse_args()
    if args.spike:
        correct, labelled = spike_precision(args.spike)
        precision = correct / labelled if labelled else 0.0
        print(f"labelled={labelled} correct={correct} precision={precision:.1%} (exit criterion >= 85%)")
        return 0 if labelled >= 25 and precision >= 0.85 else 1
    report = evaluate(args.root)
    print(f"pages={report.pages}")
    print(f"email precision={report.emails.precision:.1%} recall={report.emails.recall:.1%}")
    print(f"phone precision={report.phones.precision:.1%} recall={report.phones.recall:.1%}")
    print(f"category accuracy={report.category_accuracy:.1%} ({report.categories_total} labelled)")
    if report.traps_hit:
        print("traps extracted (false positives):", ", ".join(report.traps_hit))
    ok = (
        report.emails.precision >= args.min_precision
        and report.emails.recall >= args.min_recall
        and report.phones.precision >= args.min_precision
        and not report.traps_hit
    )
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
