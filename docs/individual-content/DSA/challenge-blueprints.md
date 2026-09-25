# Multi-Stage Challenge Blueprints

These are staging designs for later `challenge_group_id` use. They can initially be represented as ordinary grouped questions once the content schema supports the metadata.

Each challenge should collect separate evidence rather than collapse everything into one solved/not-solved result.

## 1. Duplicate Event Guard

**Context:** an ingestion service must ignore duplicate event IDs.  
**Primary family:** `dsa.hash.membership`  
**Transfer group:** `repeated_membership_state`

Stages:

1. `recognize` — highlight the repeated membership question.
2. `reason` — identify the baseline repeated scan.
3. `differentiate` — set vs dictionary: do we need associated values?
4. `trace` — update `seen` over a short event stream.
5. `diagnose` — find a bug caused by the wrong check/update order.
6. `construct` — implement deduplication.
7. `transfer` — same structure in visited-state suppression.

## 2. API Request Window

**Context:** detect or limit requests in a rolling time interval.  
**Primary family:** `dsa.sliding_window.variable` or fixed variant, depending on exact requirement.  
**Transfer group:** `moving_contiguous_range`

Stages:

1. `discover` — show naive rescanning of recent events.
2. `reason` — identify overlapping work.
3. `recognize` — identify a contiguous ordered active range.
4. `differentiate` — sliding window vs prefix aggregate.
5. `trace` — add new timestamp, expire old timestamps.
6. `diagnose` — left pointer moves but outgoing state is not removed.
7. `construct` — implement.
8. `transfer` — unlabeled string/array validity problem.

## 3. Maintenance Window Consolidator

**Context:** combine overlapping maintenance windows.  
**Family:** `dsa.intervals.sort_merge`  
**Transfer group:** `overlap_then_merge`

Stages:

1. `recognize` — input is a set of ranges.
2. `reason` — why raw input order is inconvenient.
3. `construct` — choose a sort key.
4. `trace` — merge one next interval.
5. `diagnose` — incorrect overlap condition.
6. `transfer` — booking/calendar scenario with different endpoint semantics.

## 4. Priority Work Scheduler

**Context:** repeatedly process the highest/lowest priority pending job.  
**Family:** `dsa.heap.priority_selection`  
**Transfer group:** `priority_frontier`

Stages:

1. `differentiate` — heap vs sorting the whole collection after every insertion.
2. `reason` — define priority and root invariant.
3. `trace` — push/pop over a tiny queue.
4. `diagnose` — reversed min/max priority.
5. `construct` — implement top-priority processing.
6. `transfer` — maintain top-K metrics instead of scheduling.

## 5. Minimum Feasible Worker Capacity

**Context:** choose the minimum capacity that allows all batches to finish under a fixed constraint.  
**Family:** `dsa.binary_search.monotonic_predicate`  
**Transfer group:** `monotonic_feasibility_boundary`

Stages:

1. `reason` — write a feasibility predicate.
2. `recognize` — show that feasibility is monotonic across capacity.
3. `differentiate` — binary search vs ordinary optimization scan.
4. `trace` — candidate interval + predicate results.
5. `diagnose` — boundary update does not shrink or loses a feasible candidate.
6. `construct` — implement boundary search.
7. `transfer` — different capacity/threshold story.

## 6. Deployment Dependency Planner

**Context:** deployment tasks have prerequisites.  
**Family:** `dsa.graph.topological_dependencies`  
**Transfer group:** `dependency_order`

Stages:

1. `recognize` — convert prerequisites into directed edges.
2. `reason` — define indegree.
3. `trace` — process zero-indegree queue.
4. `diagnose` — edge direction / indegree decrement bug.
5. `construct` — output a valid order or report a cycle.
6. `transfer` — package build / workflow-DAG scenario.

## 7. Service-Hop Investigation

**Context:** find the minimum number of service-to-service hops from an incident source to a target service.  
**Family:** `dsa.graph.bfs_shortest_unweighted`  
**Transfer group:** `equal_cost_frontier`

Stages:

1. `differentiate` — BFS vs DFS.
2. `reason` — why layer order gives minimum hops.
3. `trace` — queue + visited.
4. `diagnose` — visited marking too late.
5. `construct` — shortest hop count.
6. `transfer` — grid/transformation problem with the same equal-cost structure.

## 8. Directory Aggregate

**Context:** compute a hierarchical property over a directory/tree.  
**Family:** `dsa.tree.dfs_return_state`  
**Transfer group:** `hierarchical_combine`

Stages:

1. `reason` — define recursive return contract.
2. `trace` — leaves return base state; parent combines.
3. `diagnose` — base case inconsistent with return contract.
4. `construct` — implement aggregate.
5. `transfer` — binary-tree property under a different story.

## 9. Valid Configuration Generator

**Context:** enumerate configurations subject to constraints.  
**Family:** `dsa.backtracking.choose_explore_undo`  
**Transfer group:** `choice_tree_search`

Stages:

1. `recognize` — solution is a sequence of choices.
2. `reason` — define partial state.
3. `trace` — choose / recurse / undo.
4. `diagnose` — missing undo or mutable-state aliasing.
5. `reason` — identify a safe pruning rule.
6. `construct` — implement generator.
7. `transfer` — different combinatorial constraint problem.

## 10. Resource Allocation With Reused States

**Context:** choose allocations/steps where many decision paths reach the same remaining-state problem.  
**Family:** `dsa.dp.state_transition`  
**Transfer group:** `reused_subproblem_state`

Stages:

1. `discover` — show recursive baseline.
2. `reason` — identify repeated subproblem.
3. `reason` — define exact `dp[state]`.
4. `construct` — write transition.
5. `trace` — fill a tiny memo/table.
6. `diagnose` — incomplete memo key or base case.
7. `construct` — implement memoized/tabulated version.
8. `transfer` — same state-reuse idea in a sequence/grid context.

# Challenge authoring rules

- A challenge is not one giant question.
- Each stage should target one decision.
- Early stages may be scaffolded; final transfer should be unlabeled.
- Do not require the learner to re-read a long story at every stage.
- Keep the shared scenario visible but concise.
- Wrong answers should teach the structural distinction.
- A learner who fails implementation but succeeds at recognition/invariant should retain evidence for those parts.
- Challenge stages should be independently resumable if product architecture permits later.
