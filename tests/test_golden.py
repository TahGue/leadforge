"""Quality gate on the golden set (spec 26): precision first, traps never extracted."""

from __future__ import annotations

import csv
from pathlib import Path

from leadforge.evaluate import evaluate, spike_precision


def test_golden_set_meets_quality_gate() -> None:
    report = evaluate()
    assert report.pages >= 4
    assert report.traps_hit == []
    assert report.emails.precision >= 0.9
    assert report.emails.recall >= 0.7
    assert report.phones.precision >= 0.9
    assert report.category_accuracy >= 0.8


def test_spike_precision_counts_labels(tmp_path: Path) -> None:
    path = tmp_path / "results.csv"
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["value", "label_correct"])
        writer.writeheader()
        writer.writerows([{"value": "a", "label_correct": "y"}, {"value": "b", "label_correct": "n"}, {"value": "c", "label_correct": ""}])
    assert spike_precision(path) == (1, 2)
