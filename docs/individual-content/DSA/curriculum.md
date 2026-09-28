# DSA Curriculum Architecture

## 1. Course contract

Teach developers to recognize and reason about reusable coding-interview structures, then progressively remove scaffolding until they can solve unfamiliar problems without memorizing individual questions.

### Assumed prerequisites

Learners already know basic Python and basic CS/programming:

- loops, conditionals, functions;
- lists, dictionaries, sets, tuples;
- basic classes and references;
- basic recursion syntax;
- normal debugging;
- ordinary use of queues/stacks at a conceptual level.

The course should not spend substantial time teaching Python syntax or defining `for` loops.

## 2. What actually needs to be learned

The weak point for the target learner is often not syntax. It is **schema selection**.

A learner sees:

```text
"Given this weird story, what am I supposed to do?"
```

The course should train the transformation:

```text
surface story
    ↓
structural facts
    ↓
brute-force behavior
    ↓
repeated/expensive work
    ↓
information worth maintaining
    ↓
invariant
    ↓
algorithm family
    ↓
implementation
```

This is deliberately different from keyword rules such as:

```text
"substring" → sliding window
"sorted" → binary search
"top K" → heap
```

Those rules are sometimes useful recognition clues, but they are too shallow to be mastery.

## 3. Eight domains

### Domain 1 — Interview reasoning, complexity, and correctness

**Purpose:** provide a fallback reasoning process when no pattern is immediately visible.

Teach:

- restate requirements and constraints;
- produce a simple correct baseline;
- identify repeated work or the dominant expensive operation;
- use Big O to describe that cost, not as trivia;
- choose a data structure because of an operation it makes cheap;
- state an invariant;
- ensure progress/termination;
- identify edge cases;
- test the implementation before declaring completion.

This domain should be short and repeatedly revisited through every later domain.

### Domain 2 — Arrays/strings, hashing, and prefix state

Teach the idea of replacing repeated search/recomputation with remembered state.

Core families:

- hash membership / deduplication;
- hash lookup / frequency / index state;
- complement lookup;
- prefix aggregate;
- prefix-state counting.

The key mental model is:

> "What question am I asking about the past over and over, and can I store the answer?"

### Domain 3 — Two pointers, sliding windows, and intervals

Teach moving boundaries and overlapping candidate regions.

Core families:

- opposing two pointers;
- read/write pointers;
- fast/slow pointers;
- fixed sliding window;
- variable sliding window;
- sort-and-merge intervals.

The most important discrimination work is:

- two pointers vs sliding window;
- sliding window vs prefix state;
- interval merge vs ordinary sorting.

### Domain 4 — Linked structures, stacks, queues, and heaps

Teach data structures as constraints on **which candidate can be processed next**.

Core families:

- pointer rewiring in linked structures;
- stack / last-unresolved-item reasoning;
- monotonic stack;
- queue / frontier processing;
- heap / priority selection;
- optional secondary: k-way merge / multiple ordered streams.

Do not make implementation of a linked list from scratch a large part of the course. The interview value is pointer-state reasoning.

### Domain 5 — Binary search, sorting, and ordered reasoning

Teach discarding large portions of a search space by exploiting order.

Core families:

- exact/boundary binary search;
- binary search over a monotonic predicate / answer space;
- sort-then-scan transformation.

The invariant around the remaining candidate interval is more important than memorizing a single binary-search template.

### Domain 6 — Trees, recursion, and tries

Teach recursive decomposition and information flowing through hierarchical structure.

Core families:

- recursive decompose/combine;
- tree DFS with return state;
- tree BFS / level frontier;
- BST order reasoning;
- trie / prefix index.

The learner should see a tree problem as repeated local work over child subproblems, not as a pile of recursive syntax.

### Domain 7 — Graphs, connectivity, dependencies, and shortest paths

Teach modeling entities + relationships and selecting the traversal/ordering based on the question.

Core families:

- graph modeling + BFS/DFS traversal;
- unweighted shortest path / BFS frontier;
- dependency ordering / topological sort;
- dynamic connectivity / Union-Find;
- non-negative weighted shortest path / Dijkstra.

Grid problems should generally be treated as a **surface representation of a graph**, not as an unrelated family.

### Domain 8 — Backtracking, greedy reasoning, and dynamic programming

Teach search over choices and reuse of repeated subproblems.

Core families:

- choose → explore → undo backtracking;
- pruning;
- greedy choice with justification;
- DP state + transition using memoization/tabulation;
- sequence/grid DP as applications of state/transition design.

Do not teach "greedy" as "pick the largest-looking thing." The core question is whether a local choice can be justified as safe.

## 4. Learning sequence within a family

Recommended sequence:

### A. Worked discovery

Show one realistic problem and its reasoning.

```text
goal
→ baseline
→ repeated work
→ maintained state
→ invariant
→ solution
```

Use subgoal labels.

### B. Near transfer

Give a very similar case but remove one or two steps.

### C. Differentiate

Compare against the most plausible alternative.

Examples:

- sliding window vs prefix sum;
- heap vs sorting;
- BFS vs DFS;
- BFS vs Dijkstra;
- greedy vs DP.

### D. Trace

Make the learner advance the algorithm state.

### E. Diagnose

Give a plausible near-correct implementation and ask why it fails.

### F. Construct

First partial construction, then cold code.

### G. Farther transfer

Change the surface story while keeping the deep structure.

The pattern name should disappear in the final steps.

## 5. Block first, then mix

Initial acquisition can be family-focused:

```text
sliding window
sliding window
sliding window
```

but this should be brief.

As soon as the learner has a usable schema, practice should become discriminative:

```text
sliding window
prefix state
two pointers
hashing
sliding window
binary search
```

The real interview skill is choosing a family, not executing one after the UI already named it.

## 6. Universal interview reasoning routine

Train this explicitly:

1. Restate the required output.
2. Clarify relevant constraints and edge cases.
3. Describe a simple correct approach.
4. Identify the dominant repeated/expensive operation.
5. Ask what information could be maintained instead.
6. Identify the structural shape of the data/problem.
7. Choose a candidate family.
8. State the invariant or progress condition.
9. Implement the simplest correct version.
10. Test tiny, boundary, duplicate, empty, and adversarial cases as relevant.
11. State time and space complexity in terms of the operations actually performed.

This is the learner's fallback when pattern recognition fails.

## 7. What not to prioritize

For this target audience, avoid turning the core track into a traditional algorithms survey.

Lower priority unless a job target requires them:

- proving asymptotic lower bounds;
- AVL/red-black implementation details;
- segment trees/Fenwick trees;
- advanced string algorithms;
- network flow;
- strongly connected-component algorithms beyond basic awareness;
- Bellman-Ford unless negative edges are explicitly in scope;
- advanced geometry;
- obscure bit tricks;
- competitive-programming tricks.

They can live in optional/advanced modules later.

## 8. Success criterion

A learner should eventually be able to read an unfamiliar prompt and produce reasoning like:

> "The candidates are contiguous ranges. Adjacent candidates overlap heavily, and state changes when one element enters or leaves. I can maintain the active range instead of recomputing it. This looks like a sliding-window family. My invariant is that the current window is valid after shrinking invalid state."

That reasoning is more important than having seen the exact question before.
