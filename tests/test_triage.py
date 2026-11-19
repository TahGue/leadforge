"""Trained triage classifier: learns from labels, decides clear cases, defers the rest."""

from __future__ import annotations

from leadforge.triage import Prediction, TriageModel, decide

MILLS = [
    "Frantoio {n}: produciamo olio extravergine di oliva dalle nostre olive.",
    "Oleificio {n}, olio extravergine di oliva e frantoio a freddo.",
    "Azienda agricola {n}: uliveti, frantoio e olio extravergine.",
]
HOTELS = [
    "Hotel {n}: camere, colazione e piscina vicino al mare.",
    "Bed and breakfast {n}, camere con colazione e parcheggio.",
    "Agriturismo {n} con camere, piscina e ristorante.",
]


def examples(per_class: int = 30) -> list[tuple[str, str | None]]:
    rows: list[tuple[str, str | None]] = []
    for n in range(per_class):
        rows.append((MILLS[n % 3].format(n=n), "agriculture-food.food-processing"))
        rows.append((HOTELS[n % 3].format(n=n), "hospitality.hotels"))
        rows.append((f"Notizie {n}: cronaca, sport e meteo della città.", None))
    return rows


def test_not_enough_labels_means_no_model() -> None:
    assert TriageModel.train(examples(5), min_examples=100) is None
    # A single class is nothing to choose between.
    assert TriageModel.train([(f"Frantoio {n} olio", "a") for n in range(200)], min_examples=10) is None


def test_learns_and_explains_with_words_from_the_text() -> None:
    model = TriageModel.train(examples(), min_examples=50, min_per_class=10)
    assert model is not None and model.trained_on == 90
    text = "Frantoio Rossi: olio extravergine di oliva spremuto a freddo."
    [prediction] = model.predict([text])
    assert prediction.code == "agriculture-food.food-processing"
    assert prediction.probability > 0.5
    assert prediction.terms and all(term in text.lower() for term in prediction.terms)
    [news] = model.predict(["Notizie di oggi: cronaca e sport della città."])
    assert news.code is None  # "no industry fits" is a class it can learn


def test_rare_industries_are_left_out_of_training() -> None:
    rows = [*examples(), ("Cantina Verdi: vino rosso e bianco.", "agriculture-food.wine")]
    model = TriageModel.train(rows, min_examples=50, min_per_class=10)
    assert model is not None
    assert "agriculture-food.wine" not in set(model.pipeline.classes_)


def test_decide_defers_unsure_and_ungrounded_predictions() -> None:
    assert decide(Prediction("x", 0.95, ["frantoio"]), accept=0.85) == "industry"
    assert decide(Prediction("x", 0.60, ["frantoio"]), accept=0.85) == "defer"
    assert decide(Prediction("x", 0.95, []), accept=0.85) == "defer"
    assert decide(Prediction(None, 0.95, []), accept=0.85) == "no_industry"
