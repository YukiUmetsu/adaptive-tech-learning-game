# DSA Question Design

## 1. Design objective

A DSA question should collect evidence about **how the learner reasons**, not only whether the final output is right.

Use the planned generic pedagogy stages:

```text
discover
recognize
differentiate
reason
trace
diagnose
construct
transfer
```

These are pedagogical roles, not replacements for existing `AssessmentMode`.

## 2. Stage progression

### `discover`

Usually learning material rather than scored assessment.

Goal: expose the problem shape and why the pattern exists.

```text
real scenario
→ obvious solution
→ repeated work
→ maintained state
→ invariant
→ pattern name
```

### `recognize`

Ask the learner to identify a structural family or the evidence pointing to it.

Good:

> Which properties of this problem matter for choosing an approach?

Better than:

> Which algorithm solves "longest substring"?

Recommended interactions:

- `multiple_choice`
- `classification`
- `evidence_selection`

### `differentiate`

Present two or more plausible families.

Examples:

- sliding window vs prefix state;
- heap vs sorting;
- BFS vs DFS;
- BFS vs Dijkstra;
- greedy vs DP.

Recommended interactions:

- `classification`
- `multiple_choice`
- `evidence_selection`
- `two_dimensional_placement`

Require feedback around the decisive property.

### `reason`

Ask about repeated work, maintained state, invariant, or tradeoff.

Examples:

> What operation makes this baseline `O(n²)`?

> Which state must survive as the window moves?

> Which invariant makes this boundary update safe?

Recommended interactions:

- `evidence_selection`
- `fill_slots`
- `scenario_choice_chain`
- `multiple_choice`
- `typed_fill_blank`

### `trace`

Advance execution state.

Examples:

- pointer locations;
- queue/stack/heap contents;
- visited set;
- binary-search interval;
- current DP row;
- returned subtree summary.

Recommended interactions today:

- `ordering`
- `fill_slots`
- `typed_fill_blank`
- `reconstruction`

A dedicated trace interaction could be added later, but it is not required for V1.

### `diagnose`

Find a plausible error.

Good targets:

- wrong boundary movement;
- state not updated on removal;
- visited too late;
- heap has reversed priority;
- DP state has no precise meaning;
- greedy choice has no safety justification.

Recommended interactions:

- `spot_the_fault`
- `troubleshooting`
- `evidence_selection`
- `multiple_choice`

### `construct`

Build or implement.

Use a scaffold ladder:

1. arrange high-level steps;
2. fill key state updates;
3. repair near-correct code;
4. complete a function body;
5. cold Python implementation.

Recommended interactions:

- `reconstruction`
- `typed_fill_blank`
- `spot_the_fault`
- `python_code`

### `transfer`

Use a materially different surface context and do not reveal the pattern.

This is the strongest evidence that the learner is not merely matching chapter labels.

Recommended interactions:

- scenario + `python_code`;
- unlabeled pattern selection followed by construction;
- challenge stage with scaffold level 0–1.

## 3. Scaffold-level authoring guide

The planned `scaffold_level` should mean embedded support, not question difficulty.

| Level | Meaning | Example |
|---|---|---|
| 0 | Cold | No pattern label or strategy clue |
| 1 | Contextual clue | Draw attention to one relevant property |
| 2 | Structural clue | "The active candidates form a contiguous range" |
| 3 | Strategy clue | "Can you maintain state while moving a boundary?" |
| 4 | Approach revealed | "Use a sliding-window approach" |
| 5 | Skeleton provided | Main control flow exists; key lines missing |
| 6 | Guided reconstruction | Most solution steps supplied/reordered |

A hard problem can still be scaffold level 5. Do not conflate this with `difficulty_prior`.

## 4. High-value interaction recipes

### Recipe A — Find the repeated work

Scenario:

> A service has `n` event IDs. For each new event, the baseline implementation scans all prior IDs to see whether it is a duplicate.

Ask:

1. Which operation repeats?
2. What information would avoid the scan?
3. Which structure naturally holds that information?

### Recipe B — Pattern duel

Prompt:

> You need the total for many fixed ranges in an immutable sequence.

Options:

- sliding window
- prefix aggregate

Feedback should explain why prefix state fits arbitrary range queries while a sliding window fits one moving active range.

### Recipe C — Invariant reconstruction

Binary search:

> Complete the invariant: "If the target/boundary exists, it remains ________."

Then ask which update violates it.

### Recipe D — Trace one step

Given:

```text
values = [1, 2, 4, 6, 10]
target = 8
left = 0
right = 4
```

Ask for comparison, pointer movement, new indices, and why the discarded region cannot help.

### Recipe E — Spot the fault

```python
while left <= right:
    mid = (left + right) // 2
    if values[mid] < target:
        left = mid
```

Ask why the search can stop making progress, then repair it.

### Recipe F — Baseline → optimization

Show correct `O(n²)` code. Ask:

```text
What operation dominates?
What result of that operation could be stored?
What data structure/state would make it cheaper?
```

Then transition to implementation.

### Recipe G — Same skeleton

Show three stories:

- API request window;
- longest valid substring;
- recent fraud-event window.

Ask the learner to identify shared structure:

```text
contiguous range
enter from right
expire/remove from left
maintain validity state
```

Then reveal the common family.

### Recipe H — Cold transfer

No title like "Sliding Window Practice."

Use a new scenario where the learner must independently choose the family.

## 5. Avoid question leakage

Do not put the family name in:

- page title during transfer tests;
- learner-visible question ID;
- visible hint before requested;
- option wording that makes only one answer grammatically fit;
- code function names such as `solve_with_sliding_window`.

Internal `family_id` must remain server/authoring metadata if it would reveal the solution.

## 6. Wrong-answer feedback

Bad:

> Incorrect. The answer is sliding window.

Good:

> A heap gives repeated access to an extreme value, but this problem is about maintaining information for one contiguous range as its boundaries move. That moving-range property is the stronger clue.

Feedback should improve the **discrimination rule**.

## 7. Recommended initial family coverage

A mature family should contain roughly:

- 1–2 worked/learning examples;
- 2 recognition activities;
- 1–2 differentiation/reason activities;
- 1–2 trace activities;
- 1 diagnosis activity;
- 1 scaffolded construction;
- 1 cold construction;
- 2 transfer contexts.

Not every family needs exactly this count. The principle is that implementation should not be the only evidence.
