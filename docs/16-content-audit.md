# Adaptive Learning Content Audit Framework

**Purpose:** Reusable quality standard for reviewing any current or future Learning Track in Adaptive Learning.

This document applies to:

- certification tracks;
- technical skill tracks;
- programming-language tracks;
- AI/ML tracks;
- framework/library tracks;
- infrastructure/platform tracks;
- future non-certification learning content.

Examples may use AWS-style terminology, but the rules are intentionally domain-agnostic.

---

# Audit 1 — Learning Material

## 1. Audit goals

For every Learning Track, ask:

1. Does the material cover the knowledge actually required by the track's scope?
2. Is every section title or topic defined before the learner is expected to use it?
3. Are important products, services, tools, resources, APIs, concepts, commands, and technical terms explained in plain language?
4. Are acronyms and specialized terms defined before they are reused?
5. Does the material explicitly teach differences between similar concepts/tools/resources and when to choose each?
6. Is the wording natural, concrete, and easy to parse?
7. Is the material readable for learners with ADHD, working-memory limitations, or reading-comprehension difficulties?
8. Does the material teach what the quizzes later test?
9. Are important knowledge gaps present?
10. Can missing knowledge be added without expanding into low-value memorization or unnecessary detail?
11. Does each topic explain both **what it is** and **why/when it matters**?
12. Is the difficulty appropriate for the learner's stage instead of assuming undocumented prerequisite knowledge?

---

## 2. Source-of-truth requirement

Every Learning Track must define its scope authority.

Examples:

- official certification exam guide;
- official curriculum/objectives;
- official product documentation;
- language/framework documentation;
- published course syllabus;
- project-defined competency map;
- research literature for academic/AI tracks.

The audit should identify:

```text
Primary scope source
Supporting sources
Version / revision / date
Known changes since the last content release
```

If supporting material conflicts with the current primary source, the primary source wins.

Do not silently extend the curriculum because a topic is interesting.

---

## 3. Coverage audit

Coverage should be checked at three levels:

### A. Scope coverage

Does every required domain/objective/skill/competency appear somewhere?

### B. Teaching coverage

A concept being present in metadata is not enough.

It must actually be explained.

Bad:

```text
concept_id exists
↓
no meaningful explanation
```

Good:

```text
required concept
↓
learning node
↓
definition
↓
purpose/use
↓
mental model/example
↓
retrieval/application
```

### C. Depth coverage

Ask whether the learner receives enough detail to make the decisions expected by the track.

Avoid both extremes:

```text
too shallow:
"Redis is a cache."

too deep:
implementation details that never change a learner decision
```

The target is the **minimum sufficient depth for correct reasoning**.

---

## 4. Definition-first requirement

This is a hard authoring rule.

Every important learning topic must define the title/topic before asking the learner to compare, configure, troubleshoot, or recall it.

Before publishing a node, ask:

> **If the learner knows nothing about the words in this title, can they understand the first reveal?**

If not, add a definition.

### Common failure pattern

Bad:

```text
Title:
Operational signals

First reveal:
Metrics vs logs vs events
```

The learner may not know what an operational signal is.

Better:

```text
Definition:
Operational signals are data that show what is happening
inside or around a system.

Examples:
metrics, logs, events, traces, audit records

Then:
compare the signal types
```

The same rule applies to any domain:

- Python iterator
- tensor
- gradient
- Terraform provider
- Kubernetes controller
- IAM role
- vector embedding
- cache key
- regularization
- attention head

---

## 5. Product/service/tool definition requirement

When introducing a named technology, service, library, resource, API, or feature, explain:

1. **What is it?**
2. **What problem does it solve?**
3. **What does it actually do?**
4. **When would I use it?**
5. **What is it commonly confused with?**

Examples:

```text
Amazon SNS
Terraform provider
PyTorch DataLoader
Python generator
Kubernetes Deployment
PCA
Redis
EventBridge
```

Do not assume learners already know ecosystem jargon.

---

## 6. Similar-concept differentiation

Every track should identify concepts that learners commonly confuse.

The material should explicitly teach:

- how they differ;
- when to choose each;
- what clue points toward one;
- what the alternative is for instead.

### Examples across different track types

#### Cloud / infrastructure

- metric vs log vs trace;
- queue vs pub/sub;
- security group vs network ACL;
- VM image vs volume snapshot;
- rolling vs blue/green deployment.

#### Python

- list vs tuple;
- iterator vs iterable;
- generator vs regular function;
- `map` vs list comprehension;
- shallow copy vs deep copy.

#### Data/ML

- classification vs regression;
- precision vs recall;
- PCA vs feature selection;
- K-Means vs DBSCAN;
- validation set vs test set.

#### Deep learning

- epoch vs batch vs iteration;
- training vs inference;
- loss vs metric;
- dropout vs batch normalization;
- encoder vs decoder.

#### Terraform

- provider vs resource;
- variable vs local;
- `count` vs `for_each`;
- state vs configuration;
- plan vs apply.

### Required comparison structure

For important confusing pairs/groups, include:

1. basic distinction;
2. when-to-use comparison;
3. one realistic scenario;
4. common wrong choice and why it does not fit.

---

## 7. Required learning-node structure

For important topics, prefer this sequence:

### 1. Definition

1–2 short sentences.

### 2. Why it matters

One concrete operational/practical reason.

### 3. Core mental model

Use one:

- table;
- sequence;
- diagram;
- code example;
- worked example;
- concrete scenario.

### 4. When to use it

One realistic case.

### 5. Do not confuse it with

Only when there is a meaningful similar concept.

### 6. Recognition clue

For certifications:

> exam clue

For general tracks:

> practical clue / code clue / symptom clue

### 7. Micro-retrieval

One short check before moving on.

---

## 8. Progressive reveal rule

Progressive reveal is useful, but should not replace explanation.

Use:

```text
definition
↓
purpose
↓
progressive table / code / sequence
```

Avoid:

```text
undefined title
↓
large table
↓
learner has to infer the concept
```

Tables are best for:

- comparison;
- mapping;
- trade-offs;
- structured recall.

Code views are best for:

- syntax;
- identifying important lines;
- configuration;
- tracing behavior.

Sequences are best for:

- workflows;
- lifecycle;
- request paths;
- procedural reasoning.

---

## 9. ADHD/readability requirements

The goal is to reduce unnecessary working-memory load without reducing technical accuracy.

### Writing rules

1. One new technical idea per sentence when possible.
2. Define acronyms on first use.
3. Define terms before reusing them.
4. Prefer concrete verbs.
5. Keep definition blocks short.
6. Use examples immediately after abstract explanations.
7. Use consistent node structure.
8. Avoid long noun-heavy sentences.
9. Avoid unexplained jargon.
10. Avoid requiring memory from several cards earlier to understand the current card.
11. Break multi-step explanations into visually distinct steps.
12. Put the key rule before edge cases.
13. Do not hide the important conclusion at the end of a long paragraph.
14. Use whitespace and progressive disclosure.
15. Prefer one decision per interaction.

### Prefer

> A generator produces values one at a time. It does not build the whole result in memory first.

### Avoid as the first explanation

> Generators provide lazy iteration semantics by suspending function execution while preserving local state between successive resumptions.

The second sentence may become useful later, but not as the learner's first exposure.

---

## 10. Natural-language audit

Review every node for:

- awkward phrasing;
- unnecessarily formal wording;
- textbook-like compression;
- unexplained abbreviations;
- ambiguous pronouns;
- long sentences with multiple independent ideas;
- instructions that do not clearly say what the learner should do.

Ask:

> Would a knowledgeable human instructor naturally say this to a learner?

If not, rewrite.

---

## 11. Teach-before-test audit

Every scored question should map to content that was actually taught first, unless the question is explicitly diagnostic.

Audit:

```text
question concept
↓
learning node
↓
actual explanation exists
```

Do not accept this as sufficient:

```text
question concept_id
=
learning concept_id
```

Metadata alignment does not guarantee instructional alignment.

---

## 12. Scope-control rule

Do not turn every Learning Track into an encyclopedia.

Avoid unnecessary memorization of:

- obscure limits;
- exact prices;
- rarely used API names;
- implementation details that do not affect learner decisions;
- long feature lists;
- edge cases outside the track objective.

Add content when it improves:

- required coverage;
- conceptual understanding;
- discrimination between similar ideas;
- troubleshooting;
- applied decision making;
- transfer to realistic tasks.

---

## 13. Learning-material audit checklist

A learning node should not be considered complete unless:

- [ ] the title/topic is defined;
- [ ] technical terms are defined before reuse;
- [ ] the learner understands why the topic matters;
- [ ] named tools/services/resources have a plain-language purpose;
- [ ] the learner knows when to use the concept;
- [ ] similar concepts are compared where relevant;
- [ ] there is at least one concrete example or scenario;
- [ ] wording is natural and concise;
- [ ] progressive reveal does not replace basic explanation;
- [ ] the node does not assume undocumented prerequisite knowledge;
- [ ] quiz-tested concepts are actually taught;
- [ ] content stays within the intended track depth.

---

# Audit 2 — Questions

## 1. Audit goals

For every question bank, ask:

1. Does each question test knowledge that matters for the track?
2. Was the concept taught first?
3. Does the question test useful reasoning rather than trivia?
4. Does the bank test differences between similar concepts/tools/resources?
5. Does it test **when to use** something, not only what it is?
6. Are realistic application/troubleshooting questions present?
7. Are distractors plausible?
8. Does wrong-answer feedback teach from mistakes?
9. Is interaction-type variety sufficient?
10. Is the same interaction type shown no more than twice in a row?
11. Are semantically duplicate questions spaced apart?
12. Is the reading burden appropriate?
13. Does the sequence alternate cognitive demands enough to prevent fatigue?
14. Are low-level recall questions balanced with application questions?
15. Are high-frequency/important concepts represented proportionally?

---

## 2. Question relevance rule

Each question should have a clear reason to exist.

Good reasons:

- required objective;
- important decision rule;
- commonly confused concept;
- common operational failure;
- core syntax or API usage;
- realistic application;
- retrieval of a foundational fact.

Bad reasons:

- filling question-count targets;
- trivial wording variation;
- testing obscure details with little practical value;
- repeating the same distinction several times consecutively.

---

## 3. Hard interaction-sequencing rule

> **Never show the same `interaction_type` more than two questions consecutively when another valid question is available.**

Examples of interactions may include:

- classification;
- ordering;
- node_connection;
- reconstruction;
- evidence_selection;
- spot_the_fault;
- fill_slots;
- troubleshooting;
- scenario_choice_chain;
- configuration_builder;
- two_dimensional_placement;
- command_assembly;
- typed_fill_blank.

### Content validator

For authored/ordered question sets:

```text
if run_length(interaction_type) > 2:
    validation fails
```

### Runtime selector

Adaptive selection must also enforce variety.

```text
if last two questions use the same interaction_type:
    strongly prefer another interaction type

if no valid alternative exists:
    allow repetition rather than failing mission generation
```

This is a constraint with a safe fallback.

---

## 4. Avoid semantic repetition

Different interaction types can still ask essentially the same question.

Poor sequence:

```text
Q1:
Classify Multi-AZ as high availability.

Q2:
Connect Multi-AZ → failover.

Q3:
Fill in:
Multi-AZ primarily provides _____.
```

The UI changes, but the cognitive task barely changes.

### Better sequence

```text
Q1:
basic recall

Q2:
different concept

Q3:
application scenario using the original concept

Q4:
troubleshooting

Q5:
comparison against a plausible alternative
```

### Required semantic-spacing rule

Avoid adjacent questions that share:

- the same primary concept;
- the same decision rule;
- the same scenario shape.

Exceptions are allowed for intentional remediation after an incorrect answer, but the retry should still change the framing.

---

## 5. Cognitive-variety rule

A strong quiz should mix:

- recognition;
- recall;
- application;
- structural reconstruction;
- relationship recall;
- procedural recall;
- troubleshooting/evidence reasoning.

Do not allow a bank to become:

```text
classification
classification
classification
ordering
classification
classification
```

even if the content technically varies.

---

## 6. Similar-concept questions

Important confusing concepts should be tested explicitly.

For each important pair/group, aim for:

1. **basic distinction**
2. **when-to-use scenario**
3. **plausible distractor scenario**

Examples:

### Python

- list vs tuple;
- iterator vs iterable;
- generator vs list.

### ML

- precision vs recall;
- classification vs regression;
- K-Means vs DBSCAN.

### Cloud

- queue vs pub/sub;
- Multi-AZ vs read replica;
- ALB vs NLB;
- Config vs CloudTrail.

### Terraform

- `count` vs `for_each`;
- variable vs local;
- state vs configuration.

The best question often asks:

> Which option fits this requirement, and why?

rather than:

> What is X?

---

## 7. Scenario-quality requirements

Scenarios should:

- state the relevant requirement;
- include only evidence needed for the decision;
- use realistic terminology;
- contain plausible alternatives;
- have one clearly strongest answer under the stated conditions.

Avoid:

- fake complexity;
- irrelevant company names;
- long prose that tests reading endurance more than knowledge;
- trick wording;
- distractors that are obviously unrelated.

---

## 8. ADHD-friendly question design

Learning-mode questions should primarily test knowledge, not decoding effort.

### Prefer structure

```text
Requirement:
...

Current state:
...

What should you do?
```

or:

```text
Symptom:
...

Evidence:
...

Choose the next step.
```

This preserves realistic reasoning while reducing unnecessary reading load.

More exam-like or verbose scenario wording can be reserved for:

- full practice;
- exam simulation;
- higher difficulty.

---

## 9. Wrong-answer feedback requirement

Every scored question should have useful explanation.

For an incorrect answer, prefer:

### 1. Why the learner's choice does not fit

### 2. Why the correct answer fits

### 3. Rule to remember

Example:

> **You chose a read replica.** A read replica mainly adds read capacity and is not the standard choice for managed synchronous HA failover.
>
> **Correct: Multi-AZ.** Multi-AZ is designed for high availability and managed failover.
>
> **Remember:** Multi-AZ = availability. Read replica = read scaling.

Avoid explanations that merely repeat the correct answer.

---

## 10. Hint requirements

Hints should guide reasoning without giving away the answer.

Good hint:

> Ask whether the requirement is availability or read scaling.

Poor hint:

> Choose Multi-AZ.

Hints are especially useful for:

- complex scenario chains;
- troubleshooting;
- configuration builders;
- structural reconstruction;
- first exposure to a new interaction type.

Not every easy recall question requires a hint.

---

## 11. Distractor-quality requirements

Distractors should be:

- technically plausible;
- related to the same problem space;
- wrong because of a specific requirement mismatch.

Bad distractor:

```text
Question about database HA
Distractor:
CloudFront
```

Good distractor:

```text
Question about database HA
Distractor:
read replica
```

because learners genuinely confuse the two.

---

## 12. Teach-before-test requirement

Unless explicitly diagnostic:

```text
question
↓
must rely on
↓
material already introduced
```

If the question requires a term/service/concept never explained in learning material, either:

1. add the missing learning content; or
2. remove/replace the question.

---

## 13. Question-bank balance

Do not optimize for raw question count.

Optimize for:

- scope coverage;
- conceptual diversity;
- interaction diversity;
- realistic decisions;
- spaced retrieval;
- useful mistakes.

A smaller set of strong questions is preferable to many near-duplicates.

---

## 14. Runtime adaptive-selection rules

The selector should consider:

1. concept weakness;
2. forgetting/recency;
3. domain/objective coverage;
4. difficulty fit;
5. assessment mode;
6. interaction type;
7. recent concept history;
8. recent scenario shape.

### Variety constraints

Prefer:

- maximum 2 same interaction types in a row;
- no immediate semantic duplicate;
- avoid repeatedly testing the same concept unless remediation requires it;
- mix recall and application;
- alternate textual and manipulation-heavy interactions when practical.

---

## 15. Question-bank audit metrics

Every audit should report at least:

### Coverage

- total questions;
- questions by domain/module/objective;
- questions per concept;
- concepts tested but not taught;
- taught concepts never tested.

### Interaction diversity

- questions by interaction type;
- longest same-type run;
- count of 3+ same-type runs;
- percentage of dominant interaction type.

### Assessment diversity

- questions by assessment mode;
- recall vs application balance;
- troubleshooting/scenario coverage.

### Feedback quality

- questions with explanation;
- questions with hints;
- questions with targeted wrong-answer explanation if supported.

### Semantic duplication

Flag:

- repeated primary concept in adjacent questions;
- nearly identical prompts;
- same rule tested multiple times with only wording changes.

---

## 16. Question acceptance checklist

A question should not be considered complete unless:

- [ ] it tests relevant knowledge;
- [ ] the concept was taught first;
- [ ] wording is natural and unambiguous;
- [ ] the task is clear;
- [ ] distractors are plausible;
- [ ] the correct answer is clearly superior;
- [ ] similar concepts are differentiated where relevant;
- [ ] explanation teaches the reasoning;
- [ ] common wrong choices can be explained;
- [ ] it does not create a third identical interaction type in a row;
- [ ] it is not semantically redundant with adjacent questions;
- [ ] it stays within intended track scope;
- [ ] its reading burden matches the quiz mode/difficulty.

---

# Audit Output Format

Every future content audit should produce two separate sections:

```text
Learning Material Audit
Questions Audit
```

Each should include:

1. summary;
2. strengths;
3. coverage gaps;
4. terminology/definition issues;
5. confusing-concept comparisons;
6. readability/ADHD issues;
7. wording issues;
8. teach-before-test gaps;
9. additions/removals/replacements;
10. prioritized action list.

For question audits, also include:

11. interaction-type distribution;
12. same-type run violations;
13. semantic duplication;
14. scenario/troubleshooting coverage;
15. feedback/hint quality.

---

# Priority Order for Future Audits

## Learning material

1. Verify scope against current source of truth.
2. Add missing definitions.
3. Explain tools/services/resources in plain language.
4. Close teach→test gaps.
5. Strengthen similar-concept comparisons.
6. Rewrite compressed or awkward text.
7. Improve examples and mental models.
8. Add only high-value missing material.

## Questions

1. Remove/replace low-value repetition.
2. Enforce interaction-type variety.
3. Prevent semantic duplicates.
4. Add application/troubleshooting scenarios where missing.
5. Strengthen similar-concept decisions.
6. Improve wrong-answer feedback.
7. Add questions only for genuine coverage/reasoning gaps.

---

# Core Authoring Principle

Use this sequence as the default:

```text
DEFINE
↓
EXPLAIN WHY
↓
SHOW HOW IT WORKS
↓
COMPARE SIMILAR OPTIONS
↓
RETRIEVE
↓
APPLY
↓
TROUBLESHOOT
```

The learner should never have to guess what a topic means before being asked to reason about it.
