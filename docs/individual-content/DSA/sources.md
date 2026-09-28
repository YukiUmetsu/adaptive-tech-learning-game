# Sources and Research Notes

Reviewed 2026-09-25.

This package distinguishes:

1. **interview-scope evidence** — what employers publicly say they assess;
2. **learning-design evidence** — how to promote problem-solving transfer;
3. **technical references** — algorithm/data-structure facts.

No proprietary or leaked interview banks were used.

## Employer interview guidance

### Microsoft Careers — Technical interviewing

https://careers.microsoft.com/v2/global/en/hiring-tips/technical-interviewing

Relevant points:

- technical interviews evaluate problem solving and role-relevant skills;
- candidates should clarify ambiguity and make a plan before implementation;
- coding, testing, boundaries/error conditions, and clean code matter;
- algorithms/data structures are preparation areas;
- candidates should explain complexity and know when data structures are appropriate.

### Amazon Jobs — Software development interview topics

https://amazon.jobs/content/en-gb/how-we-hire/interview-prep/software-development-topics

Relevant point:

- Amazon explicitly says interviewers are not evaluating memorization of every detail; they look for the ability to apply knowledge to solve problems efficiently and effectively.

### Amazon Jobs — SDE II online assessment prep

https://amazon.jobs/content/en/how-we-hire/sde-ii-oa-prep

Relevant point:

- data structures and algorithms are listed among potential coding-assessment topics.

## Learning / transfer research

### Margulieux, Morrison, Decker (2020) — Subgoal-labeled worked examples

"Reducing withdrawal and failure rates in introductory programming with subgoal labeled worked examples"

https://link.springer.com/article/10.1186/s40594-020-00222-7

Relevant findings:

- subgoal labels expose procedural structure that experts may leave implicit;
- they improved formative quiz performance in the studied course;
- the subgoal group showed lower variance and fewer withdrawals/failures, though summative exam performance was not significantly higher.

Design implication: label reasoning steps such as "identify repeated work," "choose maintained state," and "preserve invariant," rather than only showing finished code.

### ACM ICER (2022) — Adaptive Parsons scaffolding

"Using Adaptive Parsons Problems to Scaffold Write-Code Problems"

https://doi.org/10.1145/3501385.3543977

Relevant findings:

- optional Parsons problems helped struggling learners get started, debug, and see strategy;
- participants spent less time on write-code problems;
- the study did not find a significant learning gain from pretest to posttest.

Design implication: use reconstruction as a scaffold, not as proof that independent coding is mastered.

### Butler et al. (2017) — Varied retrieval promotes transfer

"Retrieving and applying knowledge to different examples promotes transfer of learning"

https://pubmed.ncbi.nlm.nih.gov/29265856/

Across four experiments, applying a concept to different examples produced better transfer to new examples than repeatedly retrieving the same example.

Design implication: rotate surface contexts instead of repeating cosmetically similar variants.

### Cao & Carvalho (2026) — Variability, retrieval, worked examples, transfer

"Striking the Balance: How Variability Shapes Retrieval Practice and Worked Examples for Transfer Learning"

https://link.springer.com/article/10.1007/s10648-026-10169-w

Relevant finding:

- varied practice instances sharing underlying structure can support generalization;
- the usefulness of retrieval vs worked examples depends partly on whether initial instruction has been provided.

Design implication: begin with instruction/worked structure, then move toward varied retrieval and transfer.

### Gentner, Loewenstein, Thompson (2003) — Analogical encoding

"Learning and Transfer: A General Role for Analogical Encoding"

Author-hosted PDF:
https://groups.psych.northwestern.edu/gentner/papers/GentnerLoewensteinThompson03.pdf

Research summary:
https://www.kellogg.northwestern.edu/academics-research/research/detail/2003/learning-and-transfer-a-general-role-for-analogical-encoding/

Relevant finding:

- comparing cases can help learners abstract a common problem-solving schema and transfer it.

Design implication: "Same Skeleton" should explicitly compare structurally equivalent problems instead of merely presenting them separately.

### Kornell & Bjork (2008) — Interleaved category learning

"Learning Concepts and Categories: Is Spacing the Enemy of Induction?"

https://pubmed.ncbi.nlm.nih.gov/18578849/

Relevant finding:

- interleaved/spaced exemplars improved induction/classification of new exemplars relative to blocked presentation in the studied category-learning task, despite learners often feeling blocked study was better.

### Carvalho & Goldstone (2014) — Interleaving vs blocked category study

https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2014.00936/full

Relevant nuance:

- interleaving can improve discrimination for highly similar categories;
- blocked study can emphasize within-category similarities.

Design implication: acquire a new pattern with a short focused block, then interleave confusing alternatives.

### MIT Open Learning — Worked and faded examples

https://openlearning.mit.edu/mit-faculty/research-based-learning-findings/worked-and-faded-examples

Relevant guidance:

- worked examples are useful for non-experts;
- self-explanation and varied examples matter;
- as expertise increases, problem solving becomes more useful than continued worked-example study.

Design implication: fade scaffolding instead of permanently showing templates.

## Core technical curriculum references

### MIT OCW 6.006 — Introduction to Algorithms, Spring 2020

Syllabus:
https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/pages/syllabus/

Lecture notes:
https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/resources/lecture-notes/

Coverage includes data structures, sorting, hashing, trees, heaps, BFS/DFS, shortest paths, recursion, dynamic programming, and complexity.

### Princeton Algorithms, 4th Edition site

Graphs:
https://algs4.cs.princeton.edu/40graphs/

Undirected graphs:
https://algs4.cs.princeton.edu/41graph/

Directed graphs:
https://algs4.cs.princeton.edu/42digraph/

Tries:
https://algs4.cs.princeton.edu/52trie/

Useful for graph definitions, traversal, topological order, shortest paths, and trie/prefix structures.

### Python documentation

Tutorial / data structures:
https://docs.python.org/3/tutorial/datastructures.html

`collections.deque`:
https://docs.python.org/3/library/collections.html#collections.deque

`heapq`:
https://docs.python.org/3/library/heapq.html

`bisect`:
https://docs.python.org/3/library/bisect.html

Use these to keep Python-specific examples aligned with real standard-library behavior.

## Secondary interview-pattern sources

Used only as a sanity check on recurring interview-oriented pattern groupings, not as authorities for factual claims or for copying questions.

Examples:

https://leetcode.com/discuss/post/4039411/14-Patterns-to-Ace-Any-Coding-Interview-Question/

https://leetcode.com/discuss/post/5908573/Important-DSA-Patterns-100-to-Crack-Coding-Interviews/

Recurring community categories include two pointers, sliding window, hashing, prefix sums, binary search, heaps, trees, BFS/DFS, graphs, monotonic stacks, backtracking, and dynamic programming.

Do not copy problem statements or treat community frequency claims as measured employer statistics.

## Evidence limitations

The educational studies above are not specifically trials of experienced ADHD software developers preparing for coding interviews. They support general mechanisms such as worked examples, subgoal labeling, variability, comparison, interleaving, and scaffolding. Applying those mechanisms to this product is an instructional-design inference that should later be validated with product data.

Likewise, no public source provides a universal reliable frequency distribution for coding-interview patterns across all companies and roles. The tiering in this package is therefore a curriculum design judgment, not a statistical prediction.
