# DSA Curriculum Research and Authoring Blueprint

**Status:** staging design package, not production content  
**Reviewed:** 2026-09-25  
**Target:** `adaptive-tech-learning-game`, `cyber-td` architecture  
**Audience:** curriculum authors, content-audit agents, and later implementation agents

This package is intentionally parallel to the Phase 1 pedagogy-metadata implementation. It does **not** modify the production content schema, Rust API, planner, selector, interaction types, or existing JSON.

Its job is to answer the curriculum questions before production authoring starts:

- What should a developer actually learn to get better at coding-interview DSA without memorizing individual questions?
- Which reusable problem-solving families are worth teaching?
- What clues, invariants, and confusions define each family?
- Which engineering contexts can make the material feel less arbitrary?
- How should questions progress from guided recognition to cold transfer?
- Which misconceptions should later drive targeted remediation?
- How should transfer groups and multi-stage challenges be authored once Phase 1 metadata is available?

## Recommended course shape

Use **8 curriculum domains**, but do not present them as eight giant textbook chapters. Each domain contains a small set of reusable problem-solving families.

1. Interview reasoning, complexity, and correctness
2. Arrays/strings, hashing, and prefix state
3. Two pointers, sliding windows, and intervals
4. Linked structures, stacks, queues, and heaps
5. Binary search, sorting, and ordered reasoning
6. Trees, recursion, and tries
7. Graphs, connectivity, dependency order, and shortest paths
8. Backtracking, greedy reasoning, and dynamic programming

The learner-facing mental model should be much smaller than the raw taxonomy:

```text
problem shape → repeated work → maintained state → invariant → pattern → implementation → transfer
```

The point is not to memorize 200 problem statements. The point is to see a new story and recognize a familiar computational structure.

## Files

- `curriculum.md` — course goals, domain structure, sequencing, and teaching model.
- `pattern-taxonomy.md` — family IDs, recognition signals, invariants, variants, and boundaries.
- `question-design.md` — question stages and mappings to existing interaction types.
- `misconceptions.md` — common failure modes and later remediation targets.
- `real-world-use-cases.md` — authentic engineering contexts; weak analogies are explicitly marked.
- `transfer-groups.md` — same deep structure across different surface stories.
- `challenge-blueprints.md` — staged interview/problem journeys that can later use `challenge_group_id`.
- `coverage-matrix.md` — recommended coverage and content-volume targets.
- `sources.md` — research and technical references.
- `pattern-blueprints.yaml` — machine-friendly staging blueprint. This is **not** production JSON.
- `authoring-checklist.md` — QA checklist for later JSON authoring.

## Architectural assumptions

This design assumes the planned generic Phase 1 metadata eventually exists:

```text
family_id
stage
scaffold_level
transfer_group_id
surface_context
challenge_group_id
```

Nothing here requires the implementation to be finished yet.

The package follows the repository's content-audit principles:

- fact-check factual claims;
- prefer primary/authoritative sources;
- definition first;
- teach before test;
- differentiate similar concepts;
- keep learner-facing language concrete;
- use progressive disclosure;
- avoid proprietary/leaked interview banks;
- avoid answer leakage;
- maintain interaction variety.

## Research-driven instructional position

Employer guidance supports testing the application of fundamentals rather than pure memorization. Amazon says interviewers look for the ability to apply knowledge efficiently rather than memorizing every detail. Microsoft's technical-interview guidance emphasizes breaking down problems, planning before implementation, data-structure choice, complexity, coding, and testing.

The learning-science basis for this design is deliberately conservative:

- **worked examples + subgoal labels** help expose procedural structure that experts often leave implicit;
- **varied examples** support transfer better than repeatedly applying a concept to the same example;
- **analogical comparison** can help learners abstract a common schema across different cases;
- **interleaving** can help discriminate similar categories, while initial blocked practice remains useful for acquiring a new category;
- **Parsons/reconstruction tasks** are useful scaffolds between studying a solution and writing code from scratch;
- scaffolding should eventually fade into **unlabeled cold transfer**, because seeing the pattern name is itself a large hint.

See `sources.md` for the supporting research and technical references.

## Important product constraint

Do not turn this into "LeetCode with XP."

A correct design should make this the primary rewarding moment:

> **"I can see what kind of problem this is now."**

rather than only:

> "I got another question correct."
