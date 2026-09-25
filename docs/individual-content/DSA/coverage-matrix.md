# DSA Coverage Matrix

This is a **content planning target**, not an exam blueprint. There is no official universal coding-interview weighting.

Tiering is a product judgment based on overlap among employer guidance, standard algorithm curricula, common interview-oriented pattern taxonomies, transfer value, and suitability for the target learner. Do not present tiers as measured interview-frequency statistics.

## Tier A — must become automatic

- `dsa.hash.membership`
- `dsa.hash.lookup_state`
- `dsa.prefix.aggregate`
- `dsa.two_pointers.opposing`
- `dsa.two_pointers.read_write`
- `dsa.sliding_window.fixed`
- `dsa.sliding_window.variable`
- `dsa.intervals.sort_merge`
- `dsa.stack.unresolved_lifo`
- `dsa.stack.monotonic`
- `dsa.queue.frontier`
- `dsa.heap.priority_selection`
- `dsa.binary_search.boundary`
- `dsa.binary_search.monotonic_predicate`
- `dsa.tree.dfs_return_state`
- `dsa.tree.bfs_levels`
- `dsa.graph.traversal`
- `dsa.graph.bfs_shortest_unweighted`
- `dsa.graph.topological_dependencies`
- `dsa.backtracking.choose_explore_undo`
- `dsa.greedy.safe_choice`
- `dsa.dp.state_transition`

## Tier B — strong interview readiness

- `dsa.hash.complement_lookup`
- `dsa.prefix.state_count`
- `dsa.two_pointers.fast_slow`
- `dsa.heap.k_way_merge`
- `dsa.sort.transform_then_scan`
- `dsa.recursion.decompose_combine`
- `dsa.bst.ordered_search`
- `dsa.trie.prefix_index`
- `dsa.graph.union_find`
- `dsa.graph.dijkstra`
- `dsa.backtracking.pruning`
- `dsa.dp.sequence_grid`

## Optional/advanced later

- quickselect;
- two-heaps median;
- difference arrays;
- sweep-line variants beyond basic intervals;
- advanced tries/string matching;
- advanced DP taxonomies;
- segment/Fenwick trees;
- advanced graph algorithms;
- bit-manipulation pattern track.

## Minimum stage coverage per Tier A family

| Stage | Initial target |
|---|---:|
| Learning/worked example | 1 |
| Recognize | 2 |
| Differentiate | 1 |
| Reason | 1 |
| Trace | 1 |
| Diagnose | 1 |
| Construct | 2 |
| Transfer | 2 |

A mature Tier A family therefore has roughly 10 scored/interactive activities plus learning material. Quality matters more than hitting the count mechanically.

## Tier B target

| Stage | Initial target |
|---|---:|
| Learning/worked example | 1 |
| Recognize/reason | 2 |
| Trace or diagnose | 1 |
| Construct | 1 |
| Transfer | 1 |

## Estimated V1 bank size

A mature first bank could contain approximately:

- 22 Tier A families × 8–10 scored activities: ~176–220
- 12 Tier B families × 4–6 scored activities: ~48–72

**Total:** roughly **225–290 authored interactions** for a mature V1.

A launch MVP can be much smaller:

- 12 highest-value families;
- 6–8 scored activities each;
- ~80–100 questions plus learning nodes.

This is deliberately smaller than a solve-500-random-problems model while still providing variation for transfer and adaptive scheduling.

## Rollout order

For a learner who dislikes DSA, front-load patterns with visible payoff.

### Wave 1

1. hashing
2. two pointers
3. sliding window
4. prefix state
5. intervals
6. stack/queue
7. binary search
8. heap

### Wave 2

9. trees
10. BFS/DFS
11. topological sort
12. backtracking

### Wave 3

13. greedy
14. dynamic programming
15. Dijkstra / Union-Find / trie / secondary families

Do not force every advanced family before mixed interview practice becomes available.

## Interaction variety

Avoid:

```text
multiple choice
multiple choice
multiple choice
python code
```

Prefer:

```text
evidence selection
classification
trace/reconstruction
spot the fault
scenario reasoning
partial code
cold Python
transfer scenario
```

## Evidence requirement before "strong"

The bank should eventually provide evidence for:

- recognition;
- discrimination;
- invariant/reasoning;
- trace/diagnosis;
- implementation;
- transfer.

Recognition-only success should not be enough to imply strong mastery.
