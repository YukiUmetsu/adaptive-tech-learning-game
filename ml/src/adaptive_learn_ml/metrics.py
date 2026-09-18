"""Student-model evaluation metrics.

Kept dependency-free for Phase 0. Metrics follow the evaluation plan in
`docs/06-learning-engine.md` and `docs/09-ml-training-and-model-lifecycle.md`.
"""

from __future__ import annotations

from collections.abc import Sequence


def brier_score(
    probabilities: Sequence[float],
    outcomes: Sequence[int],
) -> float:
    """Return the mean squared error of predicted success probabilities.

    Args:
        probabilities: Predicted probability of success for each attempt, in
            the closed interval ``[0, 1]``.
        outcomes: Observed binary outcome for each attempt (``0`` or ``1``).

    Raises:
        ValueError: If the inputs are empty, have different lengths, or contain
            values outside their valid ranges.
    """
    if len(probabilities) != len(outcomes):
        raise ValueError("probabilities and outcomes must have the same length")
    if not probabilities:
        raise ValueError("at least one prediction is required")

    total = 0.0
    for probability, outcome in zip(probabilities, outcomes, strict=True):
        if not 0.0 <= probability <= 1.0:
            raise ValueError("probabilities must be within [0, 1]")
        if outcome not in (0, 1):
            raise ValueError("outcomes must be 0 or 1")
        total += (probability - outcome) ** 2

    return total / len(probabilities)
