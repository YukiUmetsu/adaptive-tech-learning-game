# DSA Misconception Inventory

These are authoring targets, not yet runtime remediation rules. A future remediation system can map stable error codes to a learning node or preferred pedagogy stage. For now, use them to design diagnosis questions and feedback.

## Reasoning / complexity

| Suggested error code | Misconception | Useful remediation |
|---|---|---|
| `dsa.complexity.multiply_all_loops` | Treats every nested loop as multiplicative without checking total pointer movement | Trace aggregate iterations |
| `dsa.complexity.ignore_data_structure_operation` | Counts the outer loop but ignores expensive lookup/sort/copy inside | Identify dominant operation |
| `dsa.optimization.pattern_before_baseline` | Jumps to a remembered pattern before establishing a correct baseline | Brute-force → bottleneck exercise |
| `dsa.invariant.unstated` | Can reproduce code but cannot state what remains true | Invariant reconstruction |

## Hashing / prefix state

| Code | Misconception | Remediation |
|---|---|---|
| `dsa.hash.set_when_value_needed` | Uses a set even though count/index/metadata is required | Set vs map differentiation |
| `dsa.hash.count_not_updated` | Frequency state does not match processed data | One-step trace |
| `dsa.hash.complement_insert_order` | Inserts/checks in the wrong order and allows unintended self-match | Trace one item |
| `dsa.prefix.off_by_one` | Prefix definition is unclear, causing incorrect range endpoints | Define `prefix[i]` explicitly |
| `dsa.prefix.state_missing_initial` | Omits a logically required empty-prefix/base state | Smallest-case trace |
| `dsa.prefix.window_confusion` | Uses sliding window for a condition that cannot be repaired monotonically | Prefix vs window duel |

## Two pointers / windows / intervals

| Code | Misconception | Remediation |
|---|---|---|
| `dsa.two_pointer.wrong_boundary` | Moves the boundary that cannot eliminate the observed mismatch | Explain discarded candidates |
| `dsa.two_pointer.requires_order` | Applies ordered pair logic to unsorted data without justification | Recognition signals |
| `dsa.fast_slow.gap_not_maintained` | Intended pointer gap/rate relationship is broken | Pointer trace |
| `dsa.window.recompute_state` | Recalculates entire window after each move | Find repeated work |
| `dsa.window.remove_not_applied` | Advances `left` without removing outgoing item from state | State trace |
| `dsa.window.shrink_condition_reversed` | Shrinks while valid instead of invalid, or vice versa | Invariant reconstruction |
| `dsa.window.nonmonotonic_condition` | Assumes ordinary expand/shrink works when validity lacks required progress property | Window vs prefix/other method |
| `dsa.interval.unsorted_merge` | Tries to merge arbitrary intervals without establishing scan order | Sort-then-scan reasoning |
| `dsa.interval.touch_overlap_rule` | Assumes endpoint touching is/is not overlap without reading the requirement | Requirement clarification |

## Stack / queue / heap / linked

| Code | Misconception | Remediation |
|---|---|---|
| `dsa.linked.next_lost` | Rewires current link before saving the rest of the list | Pointer-state trace |
| `dsa.stack.queue_confusion` | Uses FIFO when most recent unresolved context must be handled first | Stack vs queue duel |
| `dsa.monotonic.keeps_dominated` | Leaves candidates that can never matter again | Explain pop condition |
| `dsa.monotonic.wrong_direction` | Maintains increasing vs decreasing order opposite to the required boundary | Small trace |
| `dsa.heap.sort_every_time` | Re-sorts all candidates for every priority extraction | Heap vs sort duel |
| `dsa.heap.priority_reversed` | Min/max priority direction is wrong | Heap root invariant |
| `dsa.heap.topk_wrong_heap_size` | Keeps the wrong side/size of top-K candidates | Trace fixed-size heap |
| `dsa.queue.duplicate_enqueues` | Marks/discovers too late and enqueues the same state repeatedly | Queue + visited invariant |

## Binary search / ordering

| Code | Misconception | Remediation |
|---|---|---|
| `dsa.binary_search.no_progress` | Boundary update can leave interval unchanged | Trace a 2-element case |
| `dsa.binary_search.boundary_contract_mixed` | Mixes inclusive and half-open interval rules | Choose one interval contract |
| `dsa.binary_search.discards_candidate` | Update removes a still-possible boundary value | Invariant exercise |
| `dsa.binary_search.predicate_not_monotonic` | Binary searches an answer condition that can flip multiple times | Predicate classification |
| `dsa.binary_search.find_value_vs_boundary` | Uses exact-search logic for a first/last feasible boundary | Differentiate exact vs boundary |
| `dsa.sort.destroyed_identity` | Sorts despite needing original order/index and fails to preserve it | Tradeoff reasoning |

## Trees / recursion / tries

| Code | Misconception | Remediation |
|---|---|---|
| `dsa.recursion.return_contract_unclear` | Recursive function has no precise statement of what it returns | Write return contract first |
| `dsa.recursion.base_case_wrong` | Base case is missing or inconsistent with combine rule | Tiny-tree trace |
| `dsa.tree.global_vs_return_state` | Uses fragile global state when parent needs a local subtree summary | DFS return-state example |
| `dsa.tree.bfs_depth_off_by_one` | Depth/level counter updates at wrong time | Level trace |
| `dsa.bst.order_assumption` | Uses BST pruning on a tree not guaranteed to satisfy BST order | Recognition check |
| `dsa.trie.end_marker_missing` | Treats every prefix as a complete key/word | Prefix vs terminal distinction |

## Graphs

| Code | Misconception | Remediation |
|---|---|---|
| `dsa.graph.no_visited` | Revisits nodes indefinitely/repeatedly | Visited invariant |
| `dsa.graph.visited_too_late` | Marks visited after dequeue/pop, creating unnecessary duplicates | Discovery-time trace |
| `dsa.graph.directedness_ignored` | Adds reverse edges when relation is directed | Graph modeling exercise |
| `dsa.graph.grid_not_modeled` | Treats grid problem as unrelated instead of mapping cells to states/edges | Surface→graph transformation |
| `dsa.bfs.weighted_graph` | Uses ordinary BFS despite unequal edge costs | BFS vs Dijkstra duel |
| `dsa.topological.indegree_wrong_direction` | Indegree updates represent prerequisites backwards | Dependency graph trace |
| `dsa.topological.cycle_ignored` | Produces incomplete order without detecting unresolved cycle | Completion-count diagnosis |
| `dsa.union_find.static_overkill` | Uses DSU where one simple traversal would be clearer | DSU vs traversal differentiation |
| `dsa.dijkstra.negative_edge` | Applies Dijkstra where negative edges invalidate its standard guarantee | Algorithm-condition recognition |
| `dsa.dijkstra.stale_heap_entry` | Mishandles stale priority-queue entries | Priority trace |

## Backtracking / greedy / DP

| Code | Misconception | Remediation |
|---|---|---|
| `dsa.backtracking.no_undo` | Mutable choice remains after returning from a branch | Choose/explore/undo trace |
| `dsa.backtracking.alias_state` | Stores references to mutable state instead of snapshots where needed | Small Python example |
| `dsa.backtracking.prune_unsafe` | Prunes a branch without proving it cannot contain a valid solution | Pruning justification |
| `dsa.greedy.no_safety_argument` | Chooses locally best value because it "looks optimal" | Greedy vs DP duel |
| `dsa.greedy.wrong_sort_key` | Greedy proof depends on an order different from the chosen sort | Counterexample diagnosis |
| `dsa.dp.state_undefined` | Writes recurrence before defining what `dp[...]` means | State-definition exercise |
| `dsa.dp.transition_missing_case` | Transition omits a valid predecessor/choice | Trace small state graph |
| `dsa.dp.base_case_inconsistent` | Base state does not satisfy state definition | Tiny-input check |
| `dsa.dp.memo_key_incomplete` | Memo key omits a variable that changes the future result | State-sufficiency question |
| `dsa.dp.loop_order_dependency` | Tabulation computes a state before dependencies are available | Dependency-order trace |

## Authoring principle

When a learner makes one of these mistakes, feedback should state:

1. what invariant/state rule was broken;
2. why the chosen approach fails on a concrete small case;
3. what clue or rule would prevent the mistake next time.

Avoid feedback that merely reveals the correct final code.
