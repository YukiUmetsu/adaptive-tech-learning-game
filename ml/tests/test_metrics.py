import pytest

from adaptive_learn_ml import brier_score


def test_perfect_predictions_score_zero() -> None:
    assert brier_score([1.0, 0.0, 1.0], [1, 0, 1]) == 0.0


def test_confident_wrong_predictions_score_one() -> None:
    assert brier_score([0.0, 1.0], [1, 0]) == 1.0


def test_known_value() -> None:
    # (0.8 - 1)^2 + (0.6 - 0)^2 + (0.3 - 0)^2 = 0.04 + 0.36 + 0.09 = 0.49 / 3
    result = brier_score([0.8, 0.6, 0.3], [1, 0, 0])
    assert result == pytest.approx(0.49 / 3)


def test_mismatched_lengths_raise() -> None:
    with pytest.raises(ValueError, match="same length"):
        brier_score([0.5, 0.5], [1])


def test_empty_input_raises() -> None:
    with pytest.raises(ValueError, match="at least one"):
        brier_score([], [])


def test_probability_out_of_range_raises() -> None:
    with pytest.raises(ValueError, match=r"\[0, 1\]"):
        brier_score([1.5], [1])


def test_invalid_outcome_raises() -> None:
    with pytest.raises(ValueError, match="0 or 1"):
        brier_score([0.5], [2])


def test_package_exposes_version() -> None:
    import adaptive_learn_ml

    assert adaptive_learn_ml.__version__ == "0.1.0"
