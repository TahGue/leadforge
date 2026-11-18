"""The model benchmark scores what would actually be stored (no model needed)."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import httpx

from leadforge.ai_eval import evaluate_model, load_taxonomy

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

TAXONOMY = load_taxonomy(Path(__file__).resolve().parents[1] / "data" / "taxonomy" / "leadforge-v1.json")


def test_taxonomy_lists_subsectors() -> None:
    codes = {code for code, _ in TAXONOMY}
    assert "construction.buildings" in codes and "construction" not in codes


def test_scores_grounded_ungrounded_and_abstaining_answers() -> None:
    answers = iter(
        [
            {"industry_code": "construction.buildings", "confidence": 0.9, "evidence": "bygger flerbostadshus", "language": "sv"},
            {"industry_code": "it-software.development", "confidence": 0.9, "evidence": "not in the text", "language": "en"},
            {"industry_code": None, "confidence": 0.2, "evidence": None, "language": "en"},
            {"industry_code": "it-software.development", "confidence": 0.9, "evidence": "bakery making bread", "language": "en"},
        ]
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"message": {"content": json.dumps(next(answers))}})

    items: list[dict[str, object]] = [
        {"id": "a", "text": "Vi bygger flerbostadshus.", "expected": "construction.buildings"},
        {"id": "b", "text": "Bakery.", "expected": "agriculture-food.food-processing"},
        {"id": "c", "text": "Welcome to our website.", "expected": None},
        {"id": "d", "text": "We are a bakery making bread.", "expected": "agriculture-food.food-processing"},
    ]
    result = asyncio.run(evaluate_model("fake", items, TAXONOMY, "http://ollama.test", httpx.MockTransport(handler)))
    assert result.correct == 2  # a (grounded, right) and c (correct abstention)
    assert result.false_stores == 1  # d: grounded but wrong code would be stored
    assert result.stored == 2 and result.abstained == 2
