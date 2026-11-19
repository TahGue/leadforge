"""Trained triage classifier that runs before the LLM (ADR-0026).

The local LLM is accurate but slow (seconds per company). Once it, or a reviewer,
has labelled enough of an organization's companies, a small text classifier
(TF-IDF features + logistic regression) is trained on those labels and decides
the clear cases in milliseconds:

  * confident industry -> a CompanyIndustry row with method MODEL, capped below
    the LLM's confidence, with the words that drove the decision as evidence;
  * confident "no industry fits" -> recorded as a classification attempt, so the
    LLM does not spend time on it;
  * anything else -> left to the LLM.

Models are trained per organization, so one tenant's labels never classify
another tenant's companies. A model is never an authority for facts: its
evidence terms always occur in the company text, and it only ever repeats
decisions the LLM or a person already made on similar text.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import FeatureUnion, Pipeline

from .ai import company_text
from .config import settings
from .store import AsyncConn, new_id

log = logging.getLogger("leadforge.triage")

VERSION = "triage-v1"
NO_INDUSTRY = "__none__"
# Below the LLM's 0.7 cap: a model that learned from the LLM is weaker evidence than the LLM.
MAX_CONFIDENCE = 0.6
# Methods whose labels are worth learning from. KEYWORD rows are guesses, MODEL rows are our own output.
LEARN_FROM = ("AI", "MANUAL")


@dataclass
class Prediction:
    code: str | None  # None means "no industry fits"
    probability: float
    terms: list[str] = field(default_factory=list)


class TriageModel:
    def __init__(self, pipeline: Pipeline, trained_on: int) -> None:
        self.pipeline = pipeline
        self.trained_on = trained_on
        self.name = f"{VERSION}:n={trained_on}"

    @classmethod
    def train(
        cls, examples: list[tuple[str, str | None]], min_examples: int | None = None, min_per_class: int | None = None
    ) -> TriageModel | None:
        """Train on (text, industry code or None) pairs; None if there is not enough to learn from."""
        min_examples = settings.triage_min_examples if min_examples is None else min_examples
        min_per_class = settings.triage_min_per_class if min_per_class is None else min_per_class
        labelled = [(text, code or NO_INDUSTRY) for text, code in examples if text.strip()]
        counts = Counter(code for _, code in labelled)
        kept = [(text, code) for text, code in labelled if counts[code] >= min_per_class]
        if len(kept) < min_examples or len({code for _, code in kept}) < 2:
            return None
        pipeline = Pipeline([
            ("features", FeatureUnion([
                ("chars", TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), min_df=2, sublinear_tf=True)),
                ("words", TfidfVectorizer(analyzer="word", ngram_range=(1, 2), min_df=2, sublinear_tf=True)),
            ])),
            ("classifier", LogisticRegression(C=4, class_weight="balanced", max_iter=2000)),
        ])
        pipeline.fit([text for text, _ in kept], [code for _, code in kept])
        return cls(pipeline, len(kept))

    def predict(self, texts: list[str]) -> list[Prediction]:
        if not texts:
            return []
        features: FeatureUnion = self.pipeline.named_steps["features"]
        classifier: LogisticRegression = self.pipeline.named_steps["classifier"]
        words: TfidfVectorizer = dict(features.transformer_list)["words"]
        vocabulary = words.get_feature_names_out()
        offset = len(dict(features.transformer_list)["chars"].vocabulary_)
        matrix = features.transform(texts)
        probabilities = classifier.predict_proba(matrix)
        coefficients = classifier.coef_
        predictions = []
        for row, probs in enumerate(probabilities):
            best = int(np.argmax(probs))
            code = str(classifier.classes_[best])
            # Binary models have one coefficient row, pointing at classes_[1].
            weights = coefficients[0] * (1 if best == 1 else -1) if coefficients.shape[0] == 1 else coefficients[best]
            word_values = matrix[row, offset:].toarray().ravel()
            contribution = word_values * weights[offset:]
            top = [int(i) for i in np.argsort(contribution)[::-1][:3] if contribution[i] > 0]
            predictions.append(Prediction(None if code == NO_INDUSTRY else code, float(probs[best]), [str(vocabulary[i]) for i in top]))
        return predictions


def decide(prediction: Prediction, accept: float | None = None) -> str:
    """'industry', 'no_industry' or 'defer' (leave it to the LLM)."""
    accept = settings.triage_accept_probability if accept is None else accept
    if prediction.probability < accept:
        return "defer"
    if prediction.code is None:
        return "no_industry"
    # Grounding: an industry decision must point at words that are in the company's own text.
    return "industry" if prediction.terms else "defer"


async def training_examples(conn: AsyncConn) -> dict[str, list[tuple[str, str | None]]]:
    """Labelled examples per organization: LLM/reviewer industries, and companies the LLM found no industry for."""
    rows = await (
        await conn.execute(
            """
            SELECT DISTINCT ON (c.id) c."organizationId", c.name, c.description, c.industry AS "industryLabel",
                   (SELECT string_agg(e."extractedValue", ' | ') FROM "SourceEvidence" e
                    WHERE e."companyId" = c.id AND e."fieldName" = 'site_name') AS site_name,
                   i.code
            FROM "CompanyIndustry" ci
            JOIN "Company" c ON c.id = ci."companyId"
            JOIN "Industry" i ON i.id = ci."industryId"
            WHERE ci.method = ANY(%s) AND c."deletedAt" IS NULL
            ORDER BY c.id, (ci.method = 'MANUAL') DESC, ci."isPrimary" DESC, ci.confidence DESC
            """,
            (list(LEARN_FROM),),
        )
    ).fetchall()
    none_rows = await (
        await conn.execute(
            """
            SELECT c."organizationId", c.name, c.description, c.industry AS "industryLabel",
                   (SELECT string_agg(e."extractedValue", ' | ') FROM "SourceEvidence" e
                    WHERE e."companyId" = c.id AND e."fieldName" = 'site_name') AS site_name,
                   NULL AS code
            FROM "Company" c
            WHERE c."deletedAt" IS NULL
              AND EXISTS (SELECT 1 FROM "SourceEvidence" e WHERE e."companyId" = c.id
                          AND e."fieldName" = 'ai_classification_attempt' AND e.method = 'ai'
                          AND e."extractedValue" = 'no_classification')
              AND NOT EXISTS (SELECT 1 FROM "CompanyIndustry" ci WHERE ci."companyId" = c.id)
            """
        )
    ).fetchall()
    by_org: dict[str, list[tuple[str, str | None]]] = {}
    for row in [*rows, *none_rows]:
        by_org.setdefault(row["organizationId"], []).append((company_text(row), row["code"]))
    return by_org


async def pending_companies(conn: AsyncConn, organization_id: str, seen: set[str], limit: int) -> list[dict[str, Any]]:
    """Unclassified companies this model has not looked at yet (same selection as the LLM queue)."""
    rows = await (
        await conn.execute(
            """
            SELECT c.id, c.name, c.description, c.industry AS "industryLabel",
                   (SELECT string_agg(e."extractedValue", ' | ') FROM "SourceEvidence" e
                    WHERE e."companyId" = c.id AND e."fieldName" = 'site_name') AS site_name
            FROM "Company" c
            WHERE c."organizationId" = %s AND c."deletedAt" IS NULL
              AND c.description IS NOT NULL AND length(c.description) > 30
              AND NOT (c.id = ANY(%s))
              AND NOT EXISTS (SELECT 1 FROM "CompanyIndustry" ci WHERE ci."companyId" = c.id)
              AND NOT EXISTS (SELECT 1 FROM "SourceEvidence" e WHERE e."companyId" = c.id AND e."fieldName" = 'ai_classification_attempt')
            ORDER BY c."updatedAt" DESC
            LIMIT %s
            """,
            (organization_id, list(seen), limit),
        )
    ).fetchall()
    return list(rows)


class Triage:
    """Holds one model per organization, retrains on a timer, and classifies pending companies."""

    def __init__(self, organizations: set[str] | None = None) -> None:
        self.organizations = organizations  # None = every organization
        self.models: dict[str, TriageModel] = {}
        self.seen: dict[str, set[str]] = {}  # deferred companies per org, reset when the model changes
        self.trained_at = 0.0

    async def maybe_retrain(self, conn: AsyncConn, force: bool = False) -> None:
        if not force and time.monotonic() - self.trained_at < settings.triage_retrain_seconds:
            return
        self.trained_at = time.monotonic()
        examples = await training_examples(conn)
        for org, rows in examples.items():
            if self.organizations is not None and org not in self.organizations:
                continue
            model = await asyncio.to_thread(TriageModel.train, rows)
            if model is None:
                continue
            if org not in self.models or self.models[org].trained_on != model.trained_on:
                self.models[org] = model
                self.seen[org] = set()
                log.info("triage model trained", extra={"organization": org, "examples": model.trained_on})

    async def run_batch(self, conn: AsyncConn, limit: int | None = None) -> dict[str, int]:
        stats = {"industry": 0, "no_industry": 0, "deferred": 0}
        for org, model in self.models.items():
            seen = self.seen.setdefault(org, set())
            rows = await pending_companies(conn, org, seen, limit or settings.triage_batch)
            if not rows:
                continue
            texts = [company_text(row) for row in rows]
            predictions = await asyncio.to_thread(model.predict, texts)
            for row, prediction in zip(rows, predictions, strict=True):
                outcome = decide(prediction)
                if outcome == "defer":
                    seen.add(row["id"])
                    stats["deferred"] += 1
                    continue
                await record(conn, row["id"], model, prediction, outcome)
                stats[outcome] += 1
            await conn.commit()
        return stats


async def record(conn: AsyncConn, company_id: str, model: TriageModel, prediction: Prediction, outcome: str) -> None:
    terms = ", ".join(f'"{term}"' for term in prediction.terms)
    if outcome == "industry":
        await conn.execute(
            """
            INSERT INTO "CompanyIndustry" (id, "companyId", "industryId", "isPrimary", confidence, method, evidence, "createdAt", "updatedAt")
            SELECT %s, %s, i.id, true, %s, 'MODEL', %s, now(), now() FROM "Industry" i WHERE i.code = %s
            ON CONFLICT ("companyId", "industryId") DO NOTHING
            """,
            (new_id(), company_id, min(prediction.probability, MAX_CONFIDENCE),
             f"terms {terms} ({model.name}, p={prediction.probability:.2f})", prediction.code),
        )
    else:
        # Same audit trail as an LLM attempt, so the LLM queue skips it.
        await conn.execute(
            """
            INSERT INTO "SourceEvidence" (id, "organizationId", "companyId", "pageUrl", "fieldName", "extractedValue",
                "extractorVersion", method, snippet, "observedAt")
            SELECT %s, "organizationId", id, 'triage://' || %s, 'ai_classification_attempt', 'triage_no_industry', %s, 'model', %s, now()
            FROM "Company" WHERE id = %s
            """,
            (new_id(), model.name, model.name, f"p={prediction.probability:.2f}", company_id),
        )
