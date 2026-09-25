# DSA Pattern Taxonomy

This taxonomy is for **authoring and adaptive metadata**, not necessarily learner-facing navigation. The learner-facing UI can group several related families under a simpler toolbelt card.

Each family should be taught through problem shape, repeated work, maintained state, invariant, recognition signals, confusing alternatives, multiple surface contexts, and eventual cold transfer.

## Domain 1 — Reasoning / correctness

### `dsa.reasoning.bruteforce_to_bottleneck`

- **Shape:** a simple solution is correct but repeats an expensive operation.
- **Question:** what work dominates, and what information would eliminate it?
- **Key lesson:** optimize the repeated operation, not the story.
- **Confused with:** premature pattern matching.

### `dsa.reasoning.invariant_progress`

- **Shape:** an iterative/recursive algorithm must preserve correctness while shrinking or advancing state.
- **Question:** what remains true after every step, and why must the algorithm eventually stop?
- **Examples:** binary-search candidate interval, valid sliding window, visited graph frontier.

### `dsa.reasoning.complexity_by_operation`

- **Shape:** determine how many times an expensive operation can happen overall.
- **Key lesson:** count aggregate work rather than multiplying loop nesting mechanically.

## Domain 2 — Hashing / prefix state

### `dsa.hash.membership`

- **Shape:** repeatedly ask whether an item has appeared or belongs to a known set.
- **Repeated work:** rescanning previous items.
- **Maintained state:** `set`.
- **Invariant:** set contains exactly the values whose membership should currently count.
- **Signals:** seen before, deduplicate, membership, visited.
- **Confused with:** frequency map when counts/associated values matter.

### `dsa.hash.lookup_state`

- **Shape:** repeatedly retrieve information keyed by a value.
- **Maintained state:** dictionary/map.
- **Examples:** frequency, last index, accumulated metadata.
- **Invariant:** map meaning must be stated precisely (`count[value]`, `last_seen[value]`, etc.).

### `dsa.hash.complement_lookup`

- **Shape:** current item determines a counterpart/value that would complete a condition.
- **Repeated work:** scan all candidates for that counterpart.
- **Maintained state:** seen values or value→index mapping.
- **Confused with:** two pointers when sorted order can be exploited.

### `dsa.prefix.aggregate`

- **Shape:** many queries ask for aggregate information over fixed ranges.
- **Repeated work:** recomputing each range.
- **Maintained state:** cumulative prefix state.
- **Invariant:** prefix at index `i` summarizes a precisely defined prefix.
- **Confused with:** sliding window when one active range moves and changes incrementally.

### `dsa.prefix.state_count`

- **Shape:** answer depends on the relationship between current cumulative state and a previously observed cumulative state.
- **Maintained state:** prefix state plus map/set of earlier states.
- **Use:** subarray/range conditions expressible as a difference between prefix states.

## Domain 3 — Pointers / windows / intervals

### `dsa.two_pointers.opposing`

- **Shape:** ordered sequence; candidates can be discarded by comparing ends/positions.
- **State:** `left`, `right`.
- **Invariant:** discarded positions cannot participate in an unseen valid/better solution.
- **Confused with:** binary search and sliding window.

### `dsa.two_pointers.read_write`

- **Shape:** scan input while compacting/filtering/rearranging in place.
- **State:** read position and write position.
- **Invariant:** processed prefix already satisfies the output condition.

### `dsa.two_pointers.fast_slow`

- **Shape:** two traversals move at different rates or maintain a fixed gap.
- **Use:** cycles, midpoint, nth-from-end, phase relationships.
- **Invariant:** relationship between the pointer positions is maintained.

### `dsa.sliding_window.fixed`

- **Shape:** every candidate is a contiguous region of the same size.
- **Repeated work:** recomputing aggregate/state for almost-identical neighboring windows.
- **Invariant:** maintained state describes exactly the current `k` elements.

### `dsa.sliding_window.variable`

- **Shape:** contiguous range grows and can be repaired by moving the left boundary.
- **State:** left/right plus validity state.
- **Invariant:** after repair, active window satisfies the chosen validity rule.
- **Important limit:** the common linear expand/shrink pattern needs a condition where boundary movement has a usable progress/monotonic property.
- **Confused with:** prefix-state methods for conditions that cannot be repaired monotonically.

### `dsa.intervals.sort_merge`

- **Shape:** each item is a range `[start, end]`; overlap/order drives the result.
- **Transformation:** sort by a meaningful boundary, then scan.
- **Invariant:** merged/accepted prefix is final relative to processed intervals.

## Domain 4 — Linked / stack / queue / heap

### `dsa.linked.pointer_rewire`

- **Shape:** correctness depends on changing links without losing reachability.
- **State:** `prev`, `current`, `next` or equivalent.
- **Invariant:** processed and unprocessed portions remain reachable according to the transformation.

### `dsa.stack.unresolved_lifo`

- **Shape:** the most recently opened/unresolved item must be handled first.
- **State:** stack of unresolved contexts.
- **Use:** nesting, parsing, undo, traversal state.

### `dsa.stack.monotonic`

- **Shape:** need nearest previous/next item satisfying an order relation; dominated candidates can be discarded.
- **State:** monotonic stack of unresolved candidates.
- **Invariant:** stack preserves monotonic order and contains only candidates still able to matter.
- **Confused with:** heap (global extreme) and ordinary stack (nesting only).

### `dsa.queue.frontier`

- **Shape:** process candidates in arrival/level order.
- **State:** FIFO frontier.
- **Invariant:** queued items are discovered but not yet processed.

### `dsa.heap.priority_selection`

- **Shape:** repeatedly need the smallest/largest/best-priority candidate while data changes.
- **State:** heap.
- **Invariant:** heap order guarantees the root is the current extreme according to priority.
- **Confused with:** sorting once when all data is static.

### `dsa.heap.k_way_merge`

- **Shape:** several individually ordered streams/sequences must be merged or consumed globally in order.
- **State:** one frontier item from each active source in a heap.
- **Invariant:** heap contains the next candidate from each source; global next item is at the root.

## Domain 5 — Binary search / order

### `dsa.binary_search.boundary`

- **Shape:** ordered data or predicate; eliminate half of remaining candidates each step.
- **State:** candidate interval.
- **Invariant:** if the desired boundary/target exists, it remains in the active interval.
- **Use:** exact lookup, first/last valid position, insertion boundary.

### `dsa.binary_search.monotonic_predicate`

- **Shape:** candidate answers can be ordered and feasibility changes at most once from false→true or true→false.
- **State:** search interval over possible answers.
- **Invariant:** boundary between infeasible/feasible answers remains in the active range.
- **Use:** minimum feasible capacity, maximum valid threshold.

### `dsa.sort.transform_then_scan`

- **Shape:** global order reveals adjacency, overlap, grouping, or monotonic structure hidden in raw input.
- **Tradeoff:** spend sorting cost to simplify later logic.
- **Question:** does sorting destroy information the result depends on?

## Domain 6 — Trees / recursion / tries

### `dsa.recursion.decompose_combine`

- **Shape:** solution is composed from smaller same-shaped subproblems.
- **State:** call parameters + returned summary.
- **Invariant:** function contract clearly states what each call returns.
- **Confused with:** backtracking, which explores choices and undoes state.

### `dsa.tree.dfs_return_state`

- **Shape:** parent answer depends on summaries from child subtrees.
- **State:** recursive return value(s).
- **Invariant:** each call returns a precisely defined property for its subtree.

### `dsa.tree.bfs_levels`

- **Shape:** need level order / minimum edge depth / layer-by-layer processing.
- **State:** FIFO frontier.
- **Invariant:** current frontier corresponds to the next depth/distance to process.

### `dsa.bst.ordered_search`

- **Shape:** tree ordering lets one subtree be discarded based on comparison.
- **Invariant:** BST ordering holds for the candidate search region.

### `dsa.trie.prefix_index`

- **Shape:** operations depend on prefixes of string/key sequences.
- **State:** path through characters/tokens.
- **Invariant:** node reached represents exactly a prefix.

## Domain 7 — Graphs

### `dsa.graph.traversal`

- **Shape:** entities connected by arbitrary relationships; need reachability/components/exploration.
- **State:** adjacency representation + visited + DFS stack/recursion or BFS queue.
- **Invariant:** visited nodes are not processed as new again.
- **Surface forms:** explicit graph, grid, dependency network, social/network relationships.

### `dsa.graph.bfs_shortest_unweighted`

- **Shape:** minimum number of equal-cost edges/steps.
- **State:** BFS frontier and visited/distances.
- **Invariant:** first discovery/processing occurs at minimum hop count under ordinary unweighted BFS assumptions.
- **Confused with:** Dijkstra when edge costs differ.

### `dsa.graph.topological_dependencies`

- **Shape:** directed prerequisites/dependencies require an order.
- **State:** indegrees + zero-indegree queue, or DFS ordering with cycle handling.
- **Invariant:** emitted item has no unmet prerequisite among remaining items.

### `dsa.graph.union_find`

- **Shape:** repeated merges and connectivity queries among disjoint groups.
- **State:** parent/component forest, usually with path compression/rank/size.
- **Invariant:** representatives encode component membership.

### `dsa.graph.dijkstra`

- **Shape:** shortest path with non-negative edge weights.
- **State:** tentative distances + priority queue.
- **Invariant:** once a node is finalized under Dijkstra's conditions, no later path can improve it.
- **Confused with:** BFS for equal-weight edges; algorithms that support negative edges.

## Domain 8 — Backtracking / greedy / DP

### `dsa.backtracking.choose_explore_undo`

- **Shape:** solution space is a tree of decisions; need some/all valid configurations.
- **State:** current partial candidate.
- **Invariant:** state represents the exact choices on the current search path.
- **Structure:** choose → explore → undo.

### `dsa.backtracking.pruning`

- **Shape:** many branches can be proven unable to lead to a valid/better solution.
- **Key skill:** define a safe pruning condition.
- **Invariant:** pruned branch cannot contain a required solution.

### `dsa.greedy.safe_choice`

- **Shape:** optimization problem where a locally chosen next step can be justified as not eliminating an optimal solution.
- **Key skill:** explain why the local choice is safe.
- **Confused with:** heuristic "pick what looks best" reasoning and DP.

### `dsa.dp.state_transition`

- **Shape:** overlapping subproblems; same state would otherwise be solved repeatedly.
- **State:** precise definition of `dp[state]`.
- **Transition:** how smaller/previous states produce current state.
- **Invariant:** stored result correctly represents the declared state.
- **Note:** memoization and tabulation are implementation strategies, not separate core concepts.

### `dsa.dp.sequence_grid`

- **Shape:** decisions across one/two indices or grid positions create repeated states.
- **Purpose:** practice defining state dimensions and transitions, not memorizing a table template.

# Learner-facing toolbelt

The UI does not need to expose every authoring family separately. A simpler toolbelt can group them:

1. Hashing
2. Prefix State
3. Two Pointers
4. Sliding Window
5. Intervals
6. Stack / Monotonic Stack
7. Heap / Priority
8. Binary Search
9. Linked Pointers
10. Trees / Recursion
11. BFS / Frontier
12. Graph Connectivity
13. Dependency Order / Shortest Path
14. Backtracking
15. Greedy
16. Dynamic Programming

Internal family IDs can remain more precise for adaptive evidence.
