# Transfer Groups

A `transfer_group_id` should group activities with the **same deep reasoning structure** while varying the surface representation. It should not merely mean "same domain" or "same data structure."

## `repeated_membership_state`

**Deep structure:** repeatedly ask whether state/value has been seen; rescanning is wasteful; maintain membership state.

**Contexts:** duplicate event IDs, visited graph states, processed build artifacts, duplicate records.

**Primary family:** `dsa.hash.membership`.

## `moving_contiguous_range`

**Deep structure:** candidates are contiguous; neighboring candidates overlap; right adds state; left removes/expires state; validity/aggregate updates incrementally.

**Contexts:** API request window, security login-failure window, rolling telemetry, substring constraints, contiguous transaction sequence.

**Families:** `dsa.sliding_window.fixed`, `dsa.sliding_window.variable`.

## `cumulative_range_difference`

**Deep structure:** many range answers derive from differences between cumulative states.

**Contexts:** usage totals by day, cumulative billing, event counts in immutable buckets, array/subarray range sums.

**Family:** `dsa.prefix.aggregate`.

## `ordered_candidate_elimination`

**Deep structure:** candidates are ordered; one observation proves a whole region cannot contain the answer.

**Contexts:** sorted index lookup, first acceptable version, first timestamp crossing threshold, insertion point.

**Family:** `dsa.binary_search.boundary`.

## `monotonic_feasibility_boundary`

**Deep structure:** candidate answer `x` can be tested; feasibility changes at most once along ordered `x`; search for the boundary.

**Contexts:** minimum worker capacity, smallest rate meeting a deadline, maximum threshold satisfying budget, batch capacity.

**Family:** `dsa.binary_search.monotonic_predicate`.

## `dependency_order`

**Deep structure:** directed prerequisites; item becomes available only after prerequisites; a cycle prevents a complete order.

**Contexts:** package build order, deployment stages, Airflow-style DAG tasks, course prerequisites, migration dependencies.

**Family:** `dsa.graph.topological_dependencies`.

## `equal_cost_frontier`

**Deep structure:** states are reached in layers; each transition has equal cost; first layer reaching target gives minimum hops.

**Contexts:** minimum service hops, grid movement, transformation steps, hierarchy distance.

**Families:** `dsa.graph.bfs_shortest_unweighted`, `dsa.tree.bfs_levels`.

## `priority_frontier`

**Deep structure:** candidates have priority; repeatedly process the best current candidate.

**Contexts:** priority job scheduling, top-K telemetry, merge ordered streams, weighted shortest-path frontier.

**Families:** `dsa.heap.priority_selection`, `dsa.heap.k_way_merge`, `dsa.graph.dijkstra`.

## `overlap_then_merge`

**Deep structure:** unordered ranges; sort establishes scan order; compare current range against consolidated frontier.

**Contexts:** meetings, maintenance windows, reservations, time/IP ranges.

**Family:** `dsa.intervals.sort_merge`.

## `hierarchical_combine`

**Deep structure:** node answer depends on child summaries; recursive contract defines returned state.

**Contexts:** directory size, AST property, organization aggregation, binary-tree problem.

**Families:** `dsa.recursion.decompose_combine`, `dsa.tree.dfs_return_state`.

## `dynamic_connectivity`

**Deep structure:** groups merge over time; repeatedly query whether items are in the same component.

**Contexts:** network connectivity, account/entity linking, cluster merging, graph edge additions.

**Family:** `dsa.graph.union_find`.

## `choice_tree_search`

**Deep structure:** partial candidate; make a choice; explore; undo; optionally prune impossible branches.

**Contexts:** configuration combinations, resource assignment, permissions/feature combinations, sequence generation.

**Families:** `dsa.backtracking.choose_explore_undo`, `dsa.backtracking.pruning`.

## `reused_subproblem_state`

**Deep structure:** many decision paths reach the same computational state; compute/cache state once; define transitions.

**Contexts:** sequence comparison, grid costs, resource allocation, scheduling/counting.

**Families:** `dsa.dp.state_transition`, `dsa.dp.sequence_grid`.

## `nearest_unresolved_boundary`

**Deep structure:** current item resolves previous candidates; unresolved candidates remain ordered on a stack.

**Contexts:** next higher metric reading, span/boundary analytics, histogram/range calculations.

**Family:** `dsa.stack.monotonic`.

# Transfer authoring rules

A healthy transfer group should have:

1. at least 2–3 genuinely different surface contexts;
2. the same core invariant/strategy across those contexts;
3. more than cosmetic noun replacement;
4. at least one activity with the family label hidden;
5. a requirement to extract structural clues rather than keywords.

Bad transfer pair:

```text
Longest substring A
Longest substring B
```

Better:

```text
Longest valid substring
Recent login-failure window
```

when both genuinely share the same moving-range invariant.
