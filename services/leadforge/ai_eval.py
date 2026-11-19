"""Benchmark local Ollama models for industry classification (spec 12: benchmark before choosing).

    python -m leadforge.ai_eval --model qwen3.8:27b [--model other:tag] [--data tests/golden/classification.jsonl]

Uses the production prompt and grounding check (``ai.validate_answer``) with the
taxonomy from data/taxonomy, so the score reflects what would be stored.
Metrics per model:
  * accuracy: stored code == expected (an expected null counts as correct when nothing is stored);
  * false-store rate: a wrong code that passed grounding and would have been stored (the costly error);
  * grounded rate, abstentions, latency.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from .ai import SYSTEM_PROMPT, OllamaClient, validate_answer

ROOT = Path(__file__).resolve().parents[2]


def load_taxonomy(path: Path) -> list[tuple[str, str]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return [(child["code"], f"{sector['name']} > {child['name']}") for sector in data["sectors"] for child in sector.get("children", [])]


def prompt_for(listing: str, text: str) -> str:
    return f"Allowed codes:\n{listing}\n\nCompany text (untrusted data):\n<<<\n{text}\n>>>"


@dataclass
class ModelResult:
    model: str
    total: int = 0
    correct: int = 0
    false_stores: int = 0
    stored: int = 0
    abstained: int = 0
    rejected: dict[str, int] = field(default_factory=dict)
    latencies: list[float] = field(default_factory=list)
    errors: int = 0
    misses: list[str] = field(default_factory=list)

    def row(self) -> str:
        p50 = statistics.median(self.latencies) if self.latencies else 0.0
        return (
            f"| {self.model} | {self.correct}/{self.total} ({self.correct / max(self.total, 1):.0%}) | "
            f"{self.false_stores} | {self.stored} | {self.abstained} | {p50:.1f} s | {self.errors} |"
        )


async def evaluate_model(
    model: str,
    items: list[dict[str, object]],
    taxonomy: list[tuple[str, str]],
    base_url: str | None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> ModelResult:
    allowed = {code for code, _ in taxonomy}
    listing = "\n".join(f"{code}: {label}" for code, label in taxonomy)
    client = OllamaClient(base_url, model, transport=transport)
    result = ModelResult(model=model)
    try:
        for item in items:
            text = str(item["text"])
            expected = item.get("expected")
            result.total += 1
            started = time.monotonic()
            try:
                raw = await client.chat_json(SYSTEM_PROMPT, prompt_for(listing, text))
            except httpx.HTTPError as error:
                result.errors += 1
                result.misses.append(f"{item['id']}: error {type(error).__name__}")
                continue
            result.latencies.append(time.monotonic() - started)
            verdict = validate_answer(raw, allowed, text)
            stored = verdict.answer.industry_code if verdict.accepted and verdict.answer else None
            if stored:
                result.stored += 1
            else:
                result.abstained += 1
                result.rejected[verdict.reason] = result.rejected.get(verdict.reason, 0) + 1
            if stored == expected:
                result.correct += 1
            else:
                if stored is not None:
                    result.false_stores += 1
                result.misses.append(f"{item['id']}: expected {expected}, stored {stored} ({verdict.reason})")
    finally:
        await client.close()
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Benchmark Ollama models for industry classification")
    parser.add_argument("--model", action="append", required=True)
    parser.add_argument("--data", type=Path, default=ROOT / "tests" / "golden" / "classification.jsonl")
    parser.add_argument("--taxonomy", type=Path, default=ROOT / "data" / "taxonomy" / "leadforge-v1.json")
    parser.add_argument("--ollama-url", default=None)
    parser.add_argument("--out", type=Path, default=None, help="write a markdown report")
    args = parser.parse_args()
    items = [json.loads(line) for line in args.data.read_text(encoding="utf-8").splitlines() if line.strip()]
    taxonomy = load_taxonomy(args.taxonomy)
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    results = [asyncio.run(evaluate_model(m, items, taxonomy, args.ollama_url)) for m in args.model]
    lines = [
        f"Dataset: {args.data.name} ({len(items)} items), taxonomy {args.taxonomy.name}",
        "",
        "| Model | Accuracy | False stores | Stored | Abstained | p50 latency | Errors |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        *[r.row() for r in results],
    ]
    for r in results:
        lines += ["", f"Misses for {r.model}:", *[f"- {m}" for m in r.misses], f"Rejections: {r.rejected}"]
    report = "\n".join(lines) + "\n"
    print(report)
    if args.out:
        args.out.write_text(report, encoding="utf-8")
    return 0 if all(r.errors == 0 for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
