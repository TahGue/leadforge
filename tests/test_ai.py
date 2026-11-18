"""Local AI contract: schema validation and evidence grounding (no model needed)."""

from __future__ import annotations

import asyncio
import json

import httpx

from leadforge.ai import OllamaClient, validate_answer

TEXT = "Bygg & Montage AB. Vi bygger flerbostadshus och kontor i Göteborg."
CODES = {"construction.buildings", "it-software.development"}


def answer(**fields: object) -> str:
    return json.dumps({"confidence": 0.8, "language": "sv", **fields})


def test_accepts_grounded_answer() -> None:
    verdict = validate_answer(answer(industry_code="construction.buildings", evidence="Vi bygger flerbostadshus"), CODES, TEXT)
    assert verdict.accepted


def test_rejects_evidence_not_in_text() -> None:
    verdict = validate_answer(answer(industry_code="construction.buildings", evidence="We build bridges"), CODES, TEXT)
    assert not verdict.accepted and verdict.reason == "evidence_not_in_text"


def test_rejects_code_outside_taxonomy() -> None:
    verdict = validate_answer(answer(industry_code="mining.gold", evidence="Vi bygger flerbostadshus"), CODES, TEXT)
    assert not verdict.accepted and verdict.reason == "code_not_in_taxonomy"


def test_rejects_malformed_json_and_bad_confidence() -> None:
    assert validate_answer("not json", CODES, TEXT).reason.startswith("schema")
    assert validate_answer(answer(industry_code="construction.buildings", evidence="Vi bygger", confidence=3), CODES, TEXT).reason.startswith("schema")


def test_null_classification_is_not_stored() -> None:
    verdict = validate_answer(answer(industry_code=None, evidence=None), CODES, TEXT)
    assert not verdict.accepted and verdict.reason == "no_classification"


def test_ollama_client_requests_json_format() -> None:
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(json.loads(request.content))
        return httpx.Response(200, json={"message": {"content": answer(industry_code=None)}})

    async def run() -> str:
        client = OllamaClient("http://ollama:11434", "test-model", transport=httpx.MockTransport(handler))
        try:
            return await client.chat_json("system", "user")
        finally:
            await client.close()

    content = asyncio.run(run())
    assert json.loads(content)["industry_code"] is None
    assert seen["format"] == "json" and seen["model"] == "test-model" and seen["stream"] is False
