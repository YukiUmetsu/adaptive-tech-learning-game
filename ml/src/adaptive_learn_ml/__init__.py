"""Local-first ML utilities for the adaptive learning game.

Phase 0 ships no knowledge-tracing model. It provides evaluation primitives
that the later student-model work (HLR, FSRS, DAS3H-style) will build on.
"""

from adaptive_learn_ml.metrics import brier_score

__all__ = ["__version__", "brier_score"]

__version__ = "0.1.0"
