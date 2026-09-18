# ML workspace

Local-first training and evaluation for the adaptive learning game.

Phase 0 intentionally contains **no knowledge-tracing model**. It provides only
an importable package and evaluation utilities so later phases can add HLR,
FSRS, and DAS3H-style baselines with a working test harness.

## Setup

```bash
cd ml
uv sync
```

## Checks

```bash
uv run pytest
```

## Layout

```text
ml/
  src/adaptive_learn_ml/   # importable package
  tests/                   # pytest suite
```
