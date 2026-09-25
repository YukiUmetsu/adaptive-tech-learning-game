# DSA Learning Track Design

**Status:** Product/course design specification  
**Audience:** Course authors, frontend/backend developers, content auditors, and AI agents maintaining the track  
**Primary goal:** Make data structures and algorithms interview preparation tolerable and effective for developers who already know basic Python and general CS, but dislike traditional DSA study.

---

## 1. Why This Track Exists

Many software engineers do not need another introduction to loops, dictionaries, arrays, recursion syntax, or basic programming.

The harder interview skill is recognizing the **underlying problem structure**:

> “This unfamiliar-looking problem is really a sliding-window problem.”

The track therefore optimizes for:

- pattern recognition,
- pattern discrimination,
- identifying repeated work,
- selecting state/data structures,
- stating invariants,
- tracing an algorithm,
- repairing near-correct code,
- implementing a solution after scaffolding fades,
- transferring a pattern to a new story or use case.

The track should **not** become a catalog of memorized LeetCode solutions.

The desired transformation is:

```text
hundreds of unrelated-looking problems
            ↓
a small vocabulary of reusable reasoning patterns
```

---

## 2. Target Learner

Assume the learner already knows:

- Python fundamentals,
- functions, loops, conditionals,
- lists, dictionaries, sets, tuples,
- classes at a basic level,
- basic recursion,
- ordinary debugging,
- basic CS vocabulary.

Do not spend large amounts of learning time re-teaching those topics.

The learner may:

- dislike DSA interview preparation,
- see many interview problems as arbitrary puzzles,
- procrastinate because a “study session” feels large,
- freeze when no pattern is immediately obvious,
- understand a solution after seeing it but fail to reproduce it later,
- memorize solutions without transferring them to new problems,
- lose motivation after repeated blank-editor failures.

---

## 3. Core Learning Philosophy

The central course model is:

```text
PROBLEM SHAPE
    ↓
BRUTE FORCE
    ↓
WHAT WORK REPEATS?
    ↓
WHAT INFORMATION COULD WE MAINTAIN?
    ↓
PATTERN / DATA STRUCTURE
    ↓
INVARIANT
    ↓
IMPLEMENTATION
    ↓
TRANSFER TO A DIFFERENT PROBLEM
```

The learner should understand **why a pattern exists** before memorizing its code shape.

### Bad approach

```text
“Longest substring” → memorize sliding-window template
```

### Better approach

```text
The problem asks about a contiguous region.
Nearby candidate regions overlap.
State can be updated when an item enters or leaves.
An invalid region can be repaired by moving one boundary.
Therefore we can maintain a moving window instead of recomputing every range.
```

This produces a reusable schema rather than a keyword association.

---

## 4. What Counts as Mastery

Do not measure mastery primarily by “number of problems solved.”

Track separate competencies:

| Competency | Evidence |
|---|---|
| Pattern recognition | Identify an appropriate family from an unseen problem |
| Pattern discrimination | Distinguish plausible alternatives |
| Bottleneck reasoning | Identify repeated/expensive work in brute force |
| State design | Choose what information must be maintained |
| Invariant reasoning | Explain what remains true during execution |
| Algorithm tracing | Predict state after one or more steps |
| Debugging | Find and repair a near-correct solution |
| Implementation | Write working Python |
| Edge-case reasoning | Identify empty/small/boundary/duplicate cases |
| Complexity reasoning | Explain time and space costs |
| Transfer | Apply the pattern to a different story/domain |
| Retention | Recover the skill after time has passed |

A learner should be able to fail one dimension while succeeding in another.

Example:

```text
Sliding Window

Recognition         90%
Discrimination      78%
Invariant           82%
Tracing             91%
Implementation      63%
Transfer            70%
Retention           66%
```

This is more useful than:

```text
23 / 30 questions correct
```

---

## 5. Recommended Pattern Domains

The exact number of domains may evolve, but the course should remain organized around **problem-solving families**, not academic taxonomy alone.

### Domain 1 — Interview Reasoning, Complexity, and Correctness

Teach:

- start with a simple correct solution,
- identify the expensive operation,
- complexity as a tool for locating waste,
- invariants,
- edge cases,
- explaining tradeoffs,
- proving progress/termination at an interview-appropriate level.

This domain is the universal fallback when the learner does not recognize a pattern.

---

### Domain 2 — Arrays, Strings, Hashing, and Prefix State

Core patterns:

- membership with sets,
- lookup/counting with maps,
- complement lookup,
- frequency tables,
- prefix sums,
- prefix/suffix state,
- deduplication.

Recognition examples:

```text
“Have I seen this before?”
“How many times has this occurred?”
“Can I answer many range totals without rescanning?”
```

---

### Domain 3 — Two Pointers, Sliding Window, and Intervals

Core patterns:

- opposing pointers,
- same-direction pointers,
- fast/slow pointers,
- fixed-size window,
- variable-size window,
- interval sort/merge/sweep reasoning.

Recognition examples:

```text
contiguous region
sorted sequence
overlapping ranges
moving boundaries
```

---

### Domain 4 — Stack, Queue, Linked Structure, and Heap Patterns

Core patterns:

- LIFO state,
- FIFO state,
- monotonic stack/queue,
- priority queue / heap,
- linked-list pointer manipulation where interview-relevant.

Recognition examples:

```text
“most recent unresolved item”
“process in arrival order”
“repeatedly take the smallest/largest candidate”
```

---

### Domain 5 — Binary Search, Sorting, and Ordered Reasoning

Core patterns:

- exact binary search,
- left/right boundary search,
- monotonic predicate,
- binary search on answer,
- when sorting transforms the problem.

Recognition examples:

```text
search space is ordered
true/false condition changes only once
need the minimum feasible / maximum valid value
```

---

### Domain 6 — Trees, Recursion, and Tries

Core patterns:

- DFS,
- BFS on trees,
- preorder/inorder/postorder reasoning,
- subtree information,
- recursion return-state design,
- BST properties,
- trie/prefix search.

Recognition examples:

```text
hierarchical structure
same subproblem repeats below each node
result depends on child results
prefix lookup
```

---

### Domain 7 — Graphs, Connectivity, and Shortest Paths

Core patterns:

- graph modeling,
- adjacency representation,
- DFS/BFS,
- connected components,
- cycle detection,
- topological ordering,
- Union-Find,
- Dijkstra for non-negative weighted shortest paths.

Recognition examples:

```text
dependencies
relationships
reachability
components
shortest number of hops
weighted shortest path
```

---

### Domain 8 — Backtracking, Greedy, and Dynamic Programming

Core patterns:

- choice trees,
- pruning,
- generate/search decision space,
- safe greedy choices,
- memoization,
- tabulation,
- state definition,
- transition definition,
- base cases.

Recognition examples:

```text
try combinations
repeated subproblems
optimization over choices
local decision may or may not be globally safe
```

---

## 6. Teach Patterns Through Structural Signals, Not Keywords

Avoid teaching:

```text
“Top K” → heap
“substring” → sliding window
“sorted” → binary search
```

Those rules are too shallow.

Instead, every pattern lesson should answer:

1. **What shape does the problem have?**
2. **What does brute force repeatedly do?**
3. **What information would remove that repeated work?**
4. **What state must be maintained?**
5. **What invariant makes the algorithm correct?**
6. **What similar pattern could be confused with this one?**
7. **What clue separates them?**

---

## 7. Standard Learning Node Structure

Every significant pattern node should follow this sequence.

### A. Definition

Explain the pattern in one or two plain-language sentences.

### B. Why it exists

Show the repeated work or constraint that motivates it.

### C. Real use case

Use a realistic engineering context when it genuinely fits.

### D. Brute-force version

Show the obvious solution.

### E. Bottleneck

Ask the learner to identify what is wasteful.

### F. Maintained state

Show what information replaces repeated computation.

### G. Invariant

State what must remain true.

### H. Pattern skeleton

Show a compact algorithm shape.

### I. Similar-pattern comparison

Compare against one or two realistic alternatives.

### J. Transfer example

Use the same pattern with a different story.

### K. Micro retrieval

Ask a very short recognition or reasoning question.

---

## 8. Real-World Use Cases

Use real engineering contexts when they clarify the underlying structure.

Do **not** invent fake production stories solely to make an algorithm sound practical.

| Pattern | Useful real-world framing |
|---|---|
| Hash set | Event-ID deduplication, idempotency checks |
| Hash map | Metrics aggregation, counts, lookup tables |
| Sliding window | Rate limiting, rolling metrics, security event windows |
| Two pointers | Merging sorted records, deduplicating sorted data |
| Prefix sum | Fast cumulative/range analytics |
| Binary search | Threshold/capacity search over monotonic conditions |
| Heap | Priority job scheduling, top-K monitoring, merging sorted streams |
| Queue / BFS | Shortest-hop routing, job traversal |
| DFS | File/dependency traversal, component discovery |
| Topological sort | Build order, deployment dependencies, Airflow DAG ordering |
| Union-Find | Connectivity/grouping |
| Intervals | Calendars, reservations, maintenance windows |
| Trie | Autocomplete, prefix lookup/routing |
| Backtracking | Constraint/configuration search |
| Dynamic programming | Sequence optimization, allocation, repeated-state optimization |
| Greedy | Scheduling/allocation when a locally safe choice can be justified |

When a real-world analogy is weak, say so and teach the pattern directly.

---

## 9. Discovery Before Label

Whenever practical, let the learner experience the structural problem **before revealing the pattern name**.

Example:

```text
Production problem:
A service receives timestamped requests.

Old timestamps eventually stop affecting the result.
New timestamps arrive in time order.
We need to maintain the currently relevant 60-second period.
```

Ask:

```text
What information needs to enter state?
What information becomes irrelevant?
Can the previous result be updated instead of recomputed?
```

Then reveal:

```text
You just discovered a Sliding Window.
```

This creates an “aha” moment and reduces the feeling that DSA is arbitrary terminology.

---

## 10. The Universal Interview Reasoning Routine

The learner should have one routine to use when they freeze.

```text
1. Restate the requirement.
2. Clarify constraints and edge cases.
3. Describe a simple brute-force solution.
4. Identify the expensive repeated operation.
5. Ask what information could be maintained instead.
6. Identify the structural shape of the problem.
7. Choose a candidate pattern.
8. State the invariant.
9. Implement the simplest correct version.
10. Test it with small edge cases.
11. State time and space complexity.
```

This should be trained repeatedly until it becomes automatic.

The course should reward correct **process**, not only correct final code.

---

## 11. Learning Progression

Use a scaffold that gradually removes help.

### Stage 1 — Worked example

The system explains the reasoning.

```text
goal
↓
brute force
↓
repeated work
↓
maintained information
↓
pattern
↓
invariant
↓
code
```

### Stage 2 — Pattern comparison

Example:

```text
Sliding Window vs Prefix Sum
Heap vs Sorting
BFS vs DFS
Greedy vs DP
```

### Stage 3 — Recognition

Give a new problem.

Do not ask for code.

Ask:

```text
Which pattern family fits?
What evidence supports that choice?
```

### Stage 4 — Reconstruction

Learner arranges algorithm steps or code blocks.

### Stage 5 — Trace

Learner predicts the next state.

### Stage 6 — Repair

Learner finds a bug in near-correct code.

### Stage 7 — Partial implementation

Learner fills key lines/functions.

### Stage 8 — Cold implementation

Give an unlabeled problem and a function signature.

Do not reveal the pattern name.

### Stage 9 — Transfer

Use the same structural pattern in a substantially different scenario.

---

## 12. Question Types to Prioritize

The DSA track should not rely primarily on multiple-choice quizzes.

### 12.1 Pattern Recognition

Prompt:

```text
Requirement:
Detect whether a client exceeded 100 requests during any rolling 60-second period.

Which pattern family best fits?
```

Then ask:

```text
Which property is the strongest clue?
```

Scoring should distinguish:

- lucky pattern selection,
- correct structural reasoning.

---

### 12.2 Evidence Selection

The learner highlights the clues that matter.

Example clues:

```text
✓ contiguous time range
✓ old values expire
✓ state can update incrementally
✗ tree hierarchy
✗ all permutations are required
```

This maps well to `evidence_selection`.

---

### 12.3 Pattern Duel

Force discrimination between plausible alternatives.

Example:

```text
Sliding Window or Prefix Sum?

We receive a sequence and repeatedly move the active range one element at a time.
We need to maintain a validity condition as the range changes.
```

The explanation should focus on **why the alternative is less appropriate**.

---

### 12.4 Find the Repeated Work

Show brute force.

Example:

```python
for value in values:
    for seen in earlier_values:
        if value == seen:
            ...
```

Ask:

```text
What work is repeated?
```

Then:

```text
What state/data structure could avoid it?
```

---

### 12.5 Choose the Maintained State

Example:

```text
You are tracking a moving window.

Which state is necessary?

- a frequency map
- all historical windows
- a full sorted copy after every move
- every recursive call ever made
```

---

### 12.6 Invariant Reconstruction

Example:

```text
Binary search invariant:

If the target exists, it must remain ________.
```

Or reconstruct a complete invariant from blocks.

---

### 12.7 Algorithm Reconstruction

Use `reconstruction` / Parsons-style tasks.

Example:

```text
expand right
update state
while invalid:
    remove left item
    advance left
record best answer
```

---

### 12.8 Trace One Iteration

Example:

```text
nums = [1, 2, 4, 6, 10]
target = 8
left = 0
right = 4
```

Ask for:

- comparison,
- pointer movement,
- resulting indices.

---

### 12.9 Spot the Fault

Example:

```python
while left <= right:
    mid = (left + right) // 2

    if nums[mid] < target:
        left = mid
```

Ask:

```text
Why can the search stop making progress?
```

Then repair:

```python
left = mid + 1
```

This should be a major DSA interaction type because debugging feels natural to developers.

---

### 12.10 Optimize Existing Code

Start with a correct but inefficient implementation.

Ask:

```text
What is the expensive repeated operation?
```

Then let the learner refactor it.

This is often more motivating than:

```text
Write the optimal algorithm from nothing.
```

---

### 12.11 Real Engineering Scenario → Pattern

Example:

```text
A scheduler must repeatedly run the highest-priority pending job.
```

Ask the learner to reason toward a heap.

---

### 12.12 Cold Interview Implementation

Only after sufficient scaffolding:

```text
Implement the function.

No pattern label.
No algorithm tag.
Minimal hints.
```

This is the transfer test, not the first learning interaction.

---

## 13. “Same Skeleton” Feature

After several superficially different problems using one pattern, show them together.

Example:

```text
Failed-login rate
Longest valid substring
Recent request limit
```

Then reveal:

```text
All three share:

left boundary
right boundary
incremental state
validity condition
shrink operation
```

The intended learner reaction is:

> “These are not three different problems. They are the same structure.”

This feature should be considered a high-value differentiator for the DSA track.

Possible UI name:

**Pattern Vision**

---

## 14. Mixed Practice

Early learning can be grouped by pattern.

Do not keep practice grouped by pattern indefinitely.

### Early

```text
Sliding Window
Sliding Window
Sliding Window
```

Useful while acquiring the schema.

### Later

```text
Heap
Sliding Window
DFS
Prefix Sum
Binary Search
Hashing
```

The learner must determine the pattern without the chapter title revealing the answer.

### Mastery rule

Do not count a pattern as strongly learned if the learner can only solve it when the UI says:

```text
Sliding Window Practice
```

---

## 15. Hint Ladder

A stuck learner should never be forced to stare at an empty editor indefinitely.

Use progressive hints.

### Level 0

No hint.

### Level 1

```text
What operation is repeated?
```

### Level 2

```text
You repeatedly search values that were already processed.
```

### Level 3

```text
What structure answers membership queries efficiently?
```

### Level 4

Reveal the pattern family.

### Level 5

Show the algorithm skeleton.

### Level 6

Convert the task to reconstruction/repair.

The adaptive system should record the deepest hint used.

Example evidence:

```text
solved: true
pattern_identified_without_hint: false
hint_depth: 3
implementation_success: true
```

A solution after hints is still useful evidence, but not equivalent to cold retrieval.

---

## 16. Recovery Should Be Rewarded

Avoid a learning economy where:

```text
correct immediately = reward
wrong once = failure
```

Prefer:

```text
first-attempt success
>= failure + unaided recovery
> failure + heavy hint / reveal
```

Example:

```text
Heap ❌

Explanation:
A heap is useful when repeatedly selecting an extreme candidate.
This problem instead requires maintaining a contiguous changing range.

Next problem:
Sliding Window ✓

RECOVERY
You corrected the distinction.
```

The system should reinforce improvement, not make weaker learners feel punished.

---

## 17. ADHD-Friendly Session Design

The course should minimize activation energy.

### Entry

Default CTA:

```text
⚡ Do one pattern
~5 min
```

Avoid:

```text
Choose domain
Choose topic
Choose difficulty
Choose question count
Choose mode
```

unless the learner deliberately opens advanced controls.

### Before starting

Show a bounded commitment:

```text
3 interactions
~4 minutes
```

### During a session

Prefer:

- rapid feedback,
- visible progress,
- small transitions,
- varied interaction types,
- one decision at a time,
- minimal long prose,
- no unnecessary modal interruptions.

### End

A session can end after a small success.

Do not pressure the learner into:

```text
9 more questions to complete your goal
```

Always make returning easy.

---

## 18. Avoid Punitive Streak Design

The track is already aversive for the target audience.

Do not make missed days create another source of failure.

Prefer:

- streak protection,
- flexible weekly goals,
- “welcome back” recovery missions,
- cumulative mastery that never disappears.

Example:

```text
You were away for 4 days.

Let's refresh one pattern you were close to mastering.
~3 min
```

---

## 19. Pattern Toolbelt

Represent patterns as a finite toolkit.

Example:

```text
HASHING        mastered
TWO POINTERS   applying
SLIDING WINDOW recognizing
HEAP           learning
BINARY SEARCH  not started
```

Each pattern card can contain:

### Power

What problem it solves.

### Signal

What structural clue suggests it.

### State

What the algorithm maintains.

### Invariant

What remains true.

### Weakness

When the pattern is a bad fit.

### Common confusion

What similar pattern it is often confused with.

Example:

```text
SLIDING WINDOW

Power:
Maintain information about a changing contiguous range.

Signal:
Neighboring candidate ranges overlap heavily.

State:
left, right, plus information about the active window.

Weakness:
Poor fit when relevant elements are not contiguous.

Common confusion:
Prefix sums.
```

This makes the curriculum feel finite and collectible.

---

## 20. Companion Behavior

The companion should reinforce reasoning, not output generic praise.

Avoid:

```text
Great job!
Keep going!
Amazing!
```

Prefer:

```text
You found the repeated scan. That's the important part.
```

```text
Your data-structure choice was wrong, but you correctly noticed that fast lookup matters.
```

```text
These three problems looked different, but you used the same window invariant.
```

The companion can act as a very short tutor.

---

## 21. Complexity Teaching

Do not make Big O feel like isolated math trivia.

Use complexity as a **waste detector**.

Example:

```python
for user in users:
    for banned_user in banned_users:
        if user == banned_user:
            ...
```

Ask:

```text
What work is repeated?
```

Then refactor:

```python
banned = set(banned_users)

for user in users:
    if user in banned:
        ...
```

Then explain:

```text
The important improvement is that repeated searching was replaced by maintained lookup state.
Big O describes the impact of that change.
```

Teach complexity after the learner understands the operation being counted.

---

## 22. Similar-Pattern Comparisons

These comparisons should be explicitly authored.

### Sliding Window vs Prefix Sum

**Sliding Window**

Use when the active contiguous range moves and state can be updated incrementally.

**Prefix Sum**

Use when many range aggregates can be answered from precomputed cumulative state.

---

### Two Pointers vs Sliding Window

**Two Pointers**

Often coordinates positions or shrinks/searches from boundaries.

**Sliding Window**

Maintains information about an active contiguous region as boundaries move.

---

### Heap vs Sorting

**Heap**

Useful when extreme candidates are needed repeatedly or incrementally.

**Sorting**

Useful when a one-time global order simplifies the rest of the problem.

---

### BFS vs DFS

**BFS**

Especially useful for minimum unweighted hop count / level-order reasoning.

**DFS**

Natural for recursive structure, reachability, components, and dependency exploration.

---

### Greedy vs Dynamic Programming

**Greedy**

Requires a defensible local choice that does not destroy global optimality.

**DP**

Useful when decisions create overlapping subproblems whose results can be reused.

Do not teach:

```text
“If it looks greedy, use greedy.”
```

Teach the justification.

---

## 23. Content Authoring Rules

Every learning node should pass these gates.

### Definition-first

The learner should not have to infer what the topic means from a table or code example.

### One main idea at a time

Avoid dense paragraphs.

### Concrete before abstract when useful

A short example can precede deeper terminology.

### Explain why

Never teach a template without explaining the repeated work it removes.

### Include an invariant

For major patterns, explicitly state the invariant.

### Include a confusion pair

When another technique is plausibly confused with this one.

### Use realistic examples

But do not force fake “real-world” analogies.

### Teach before testing

Every scored skill must have meaningful instructional coverage.

---

## 24. Content JSON Guidance

Use the existing learning schema rather than creating a DSA-only schema unless a missing capability is demonstrated.

Recommended structure:

```text
content/
  ai-or-cs/
    dsa-interview/
      v1/
        learning/
          learning-domain-1.json
          learning-domain-2.json
          ...
        questions/
          dsa-interview-domain-1.json
          dsa-interview-domain-2.json
          ...
```

Use stable identifiers.

Example:

```text
domain-3
domain-3-window-recognition
domain-3-window-invariant
dsa.sliding_window.recognition
dsa.sliding_window.invariant
```

Do not encode display text into IDs.

Good:

```text
dsa.sliding_window.invariant
```

Bad:

```text
longest-substring-with-at-most-k-distinct-characters
```

Patterns should remain stable even when examples change.

---

## 25. Suggested Skill IDs

A useful reusable skill model:

```text
X.1.01 pattern recognition
X.1.02 pattern discrimination
X.1.03 bottleneck identification
X.1.04 maintained-state selection
X.1.05 invariant reasoning
X.1.06 tracing
X.1.07 debugging
X.1.08 implementation
X.1.09 complexity reasoning
X.1.10 transfer
```

Do not require every module to use all ten.

The goal is to avoid treating every question as generic evidence for:

```text
“knows sliding window”
```

---

## 26. Assessment Modes

Recommended DSA-specific assessment modes:

```text
recognition
discrimination
reasoning
trace
repair
reconstruction
implementation
transfer
```

If the current API only supports broader assessment modes, map these as metadata/concepts until a strong implementation reason exists to extend the schema.

---

## 27. Adaptive Selection

The selector should consider:

- pattern weakness,
- competency weakness within the pattern,
- recency,
- forgetting risk,
- last hint depth,
- recent failures,
- recent interaction type,
- semantic similarity of recent questions,
- transfer performance,
- implementation fatigue.

Example:

```text
Learner:
Sliding-window recognition: strong
Sliding-window implementation: weak

Next mission:
Do not show another recognition multiple choice.
Give a short code repair or partial implementation.
```

Another example:

```text
Heap recognition: strong
Heap vs sorting discrimination: weak

Next mission:
Give a pattern duel.
```

---

## 28. Do Not Overuse Full Coding

Blank-editor implementation has high activation cost.

A healthy progression contains many:

- classification tasks,
- evidence selection,
- trace tasks,
- reconstruction,
- bug finding,
- partial edits,

before demanding repeated full implementation.

Full implementation is important, but it should be used when it measures the intended skill rather than simply maximizing difficulty.

---

## 29. Boss Battles

A boss battle should combine several competencies.

Example:

```text
Scenario:
A monitoring service receives latency values continuously.
Return the maximum latency in every window of 100 measurements.
```

Possible stages:

```text
1. Describe brute force.
2. Identify repeated work.
3. Choose maintained state.
4. Recognize the monotonic-deque pattern.
5. Reconstruct the invariant.
6. Trace a small example.
7. Implement Python.
8. Run tests.
9. Explain complexity.
```

The boss battle should feel like applying accumulated tools, not encountering an arbitrary difficulty spike.

---

## 30. Source and Fact-Check Policy

Follow `docs/16-content-audit.md`.

For DSA content, prefer:

1. standard algorithms/data-structures textbooks or university materials,
2. Python documentation for language/runtime behavior,
3. reputable academic/educational material,
4. primary technical documentation for real-world examples where applicable.

Do not:

- copy proprietary interview-question banks,
- reproduce LeetCode problem statements,
- depend on leaked interview questions,
- teach unsourced complexity claims,
- fabricate production use cases.

Every factual claim about an algorithm should be independently verifiable.

---

## 31. Content Audit Requirements

Every release must receive:

### Automated validation

Run the same validation enforced by the Rust content loader.

Verify:

- JSON parses,
- IDs are valid and unique,
- prerequisites resolve,
- no cycles,
- reveal structures are complete,
- table progressive-reveal IDs resolve,
- code annotations resolve,
- coverage counts match,
- source references are present.

### Editorial audit

Check:

- factual accuracy,
- source authority,
- natural English,
- definition-first teaching,
- pattern explanation quality,
- invariant correctness,
- real-use-case validity,
- similar-pattern differentiation,
- ADHD readability,
- teach-before-test coverage,
- unnecessary theory,
- accidental answer leakage.

### Question audit

Check:

- interaction diversity,
- semantic repetition,
- position predictability,
- implausible distractors,
- pattern labels accidentally revealing answers,
- weak wrong-answer feedback,
- too many full-coding tasks in a row.

---

## 32. Maintenance Strategy

### Stable concepts, replaceable examples

Separate:

```text
Pattern concept
```

from:

```text
Example problem
```

A real-world example may become stale.

The pattern does not.

Example:

```text
concept:
dsa.topological_sort.dependency_order
```

can be taught with:

- package builds,
- CI pipeline stages,
- deployment dependencies,
- Airflow DAGs.

Examples may be replaced without changing the concept identity.

### Version when semantics change

Create a new content version when:

- major domain structure changes,
- mastery mapping changes,
- task/concept IDs change incompatibly,
- a substantial course redesign alters evidence interpretation.

Minor wording/source corrections can follow the platform's existing version policy.

---

## 33. Course Quality Metrics

Track more than completion rate.

Useful metrics:

### Activation

```text
% of learners who start after opening the DSA track
```

### Session completion

```text
% completing a 3–6 minute mission
```

### Return rate

```text
Do learners voluntarily come back?
```

### Hint depth

```text
Does hint dependence decrease?
```

### Pattern transfer

```text
Can learners recognize a pattern under a new story?
```

### Cold implementation

```text
Can learners implement without the pattern label?
```

### Retention

```text
Can they recover the pattern days/weeks later?
```

### Avoidance signal

Watch for:

- quitting at blank-editor tasks,
- skipping one domain repeatedly,
- sessions ending after consecutive failures,
- long inactivity after punitive interactions.

Use these signals to improve the course, not to punish the learner.

---

## 34. Anti-Patterns for This Course

Do not build:

### “LeetCode with XP”

Gamification does not fix poor learning design.

### Pattern keyword memorization

```text
“substring” = sliding window
```

is not mastery.

### Endless problem counts

```text
Solve 100 array questions.
```

The track should feel finite.

### Algorithm-template memorization before understanding

Code skeletons are useful after the learner understands the state and invariant.

### Trivia-heavy Big O quizzes

Prefer reasoning about operations and bottlenecks.

### Immediate blank-editor difficulty

Scaffold first.

### Fake real-world stories

Use authentic analogies or no analogy.

### Pattern-labelled mastery tests

If the screen says `Sliding Window`, recognition is not being tested.

### Punitive streaks

Do not create additional avoidance pressure.

---

## 35. Product Principle

The primary reward event should be:

> “I can see what kind of problem this is now.”

not merely:

> “I got this question correct.”

The course succeeds when unfamiliar interview questions stop looking like unrelated riddles and start looking like combinations of a small number of known structures.

---

## 36. Implementation Priorities

Recommended order:

### Phase 1 — Course content

- finalize pattern taxonomy,
- create learning nodes,
- add real-use-case examples,
- author pattern comparisons,
- create recognition/trace/repair questions.

### Phase 2 — Pattern mastery model

Track:

- recognition,
- discrimination,
- invariant,
- tracing,
- repair,
- implementation,
- transfer.

### Phase 3 — Hint ladder

Record hint depth as learning evidence.

### Phase 4 — Mixed adaptive practice

Stop revealing pattern names.

### Phase 5 — Pattern Vision

Show multiple stories collapsing into the same skeleton.

### Phase 6 — Boss battles

Combine reasoning, pattern choice, code, tests, and complexity.

Do not delay the whole track waiting for every advanced feature.

Good content and mixed pattern recognition are valuable before Pattern Vision or boss-battle UI exists.

---

## 37. Author Checklist for a New Pattern

Before publishing a pattern, confirm:

- [ ] The pattern is defined in plain language.
- [ ] The motivating repeated work is explained.
- [ ] The problem shape is explicit.
- [ ] Maintained state is explained.
- [ ] The invariant is correct and understandable.
- [ ] At least one meaningful use case exists, or the course explicitly avoids forcing one.
- [ ] At least one similar pattern is contrasted.
- [ ] A learner sees a worked example before cold implementation.
- [ ] Recognition is tested without exposing the pattern name.
- [ ] There is a tracing/reconstruction/repair activity.
- [ ] There is eventual unlabeled implementation.
- [ ] There is at least one transfer problem with a different surface story.
- [ ] Complexity is explained from operations, not just memorized.
- [ ] Source references support factual claims.
- [ ] Rust content validation passes.
- [ ] The content audit passes.

---

## 38. Definition of Done for a Domain

A domain is ready when:

1. all major patterns in scope are taught,
2. every pattern includes motivation, state, and invariant,
3. confusing alternatives are compared,
4. real use cases are used where valuable,
5. early practice is scaffolded,
6. later practice is mixed and unlabeled,
7. implementation is not the only evidence type,
8. transfer is measured,
9. content validation passes,
10. editorial/content audit passes,
11. source references are attached and checked,
12. an ADHD-oriented UX review finds no unnecessary activation or reading burden.

---

## 39. One-Sentence Course Contract

> Teach developers to recognize and reason about reusable interview patterns, then progressively remove scaffolding until they can solve unfamiliar problems without memorizing individual questions.
