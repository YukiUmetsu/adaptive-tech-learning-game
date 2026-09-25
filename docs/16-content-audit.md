# Adaptive Learning Content Audit Framework

**Purpose:** reusable quality standard for reviewing any current or future Learning Track.

**Applies to:** certification tracks; technical skill tracks; programming-language tracks; AI/ML tracks; framework/library tracks; infrastructure/platform tracks; future non-certification content. Examples use AWS terms, but the rules are domain-agnostic.

**Two halves, never confused:**

1. **Machine-checked structure** — the Rust content validator over `content/**/*.json`. If it fails, content does not load.
2. **Human editorial audit** — fact-checking, source quality, natural English, teaching quality, question design. The validator cannot check any of this.

**Three hard gates** (apply to both audits): fact-check + source references (Part 2.1); natural English (Part 2.2); answer predictability for questions (Part 4.15).

---

# Part 1 — Automated content validation (Rust API)

`crates/content` parses and validates every JSON file under `content/`. Discovery is by path: `**/learning/**/*.json` → `LearningDomain`; `**/practice-tests/**/*.json` → `PracticeTest` (schema `practice-test-v2`); every other JSON file → a scored `ContentBundle`. Content is embedded at build time (`crates/content/build.rs`).

- **Runtime (API startup): lenient.** A file that fails to parse or validate is skipped and logged with its repository-relative path.
- **Tests/CI (`ContentRegistry::embedded`): strict.** Any error fails the build; this is the gate that stops bad content reaching learners.
- Every failure carries a stable machine-readable `code`, a human message, and the source path.

## 1.1 Quiz bundles (`crates/content/src/validate.rs`)

**Identity and referential integrity**

- `certification.{id, vendor, name, exam_code, official_source_url, last_reviewed}` non-empty.
- `version.{id, exam_code, content_version, effective_date}` non-empty; `version.exam_code == certification.exam_code`; ≥1 domain.
- Domains: `id`/`name` non-empty and unique; weight ∈ `(0, 1]`; weights sum to `1.0` (±1e-6).
- Concepts: `id`/`name`/`description` non-empty and unique.
- Tasks: `id`/`name` non-empty and unique; every `question_ids` entry references an authored question.
- Questions: `id`/`prompt` non-empty and unique; `content_version` matches the bundle; `certification_version` matches the version id; `domain_id`/`task_id` resolve to a real task; `difficulty_prior` ∈ `[0, 1]`; `interaction_type` matches the `interaction` shape.
- Question concepts: ≥1, all known, none duplicated, weights ∈ `(0, 1]` summing to `1.0`.
- `error_codes`: non-empty and unique, each with a code and description.
- `source_refs`: non-empty, each with non-empty `title` and `url`. *(Presence and shape only — accuracy is the fact-check gate.)*
- `pedagogy` (optional): when present, `family_id`, `transfer_group_id`, `surface_context`, and `challenge_group_id` must be non-blank (trim-aware); `scaffold_level` ∈ `0..=6`; `stage` must be a known `PedagogyStage` value (parse-time). No cross-question pedagogy rule is enforced in Phase 1.

**Interaction ↔ canonical answer** (both must match the interaction; the answer must cover the authored shape):

| Type | Interaction must | Canonical answer must |
|---|---|---|
| `classification` | ≥1 item, ≥1 category; unique ids | cover every item exactly once; known item + category ids |
| `ordering` | ≥2 items; unique ids | be an exact permutation of the items |
| `node_connection` | ≥2 nodes; non-empty id/label; `x`/`y` ∈ `[0,1]`; unique ids | edges have 2 endpoints, known nodes, no self-loop, no duplicate |
| `reconstruction` | ≥2 pieces, ≥1 slot; unique piece/slot ids; graph layouts need slot and fixed-node `x`/`y` ∈ `[0,1]`; fixed-node id ≠ piece id | cover every slot; known pieces; no piece reused; `linear` forbids edges; edges only between provided/placed components; no self-loop/duplicate |
| `evidence_selection` | ≥2 options; unique ids | ≥1 relevant id, non-duplicated, known |
| `spot_the_fault` | ≥1 element; unique ids | ≥1 faulty id, non-duplicated, known |
| `fill_slots` | ≥1 slot, ≥2 options; unique ids | cover every slot; values are known options |
| `troubleshooting` / `scenario_choice_chain` | ≥1 step; non-empty step id/prompt; each step has choices; unique step ids; globally unique choice ids; start step exists; each transition targets a choice of that step and a known step; ≥1 terminal step; every step reachable from the start | non-empty correct choices for known steps/choices; non-empty expected path whose every choice exists, is marked correct, and terminates correctly |
| `configuration_builder` | ≥1 slot, ≥1 piece; unique ids | cover every slot; known pieces; no piece reused |
| `two_dimensional_placement` | axis id/label/low/high non-empty; ≥1 item; unique ids | regions cover every item; finite `[min, max]` ⊆ `[0,1]` with `min ≤ max` |
| `command_assembly` | ≥1 slot, ≥2 tokens; unique ids | cover every slot; known tokens; no token reused |
| `typed_fill_blank` | ≥1 slot; unique id/label; every `{{slot_id}}` resolves to a slot and each slot is referenced exactly once; malformed/duplicate placeholders rejected; table columns/rows/cells complete | answers cover exactly the slots; `accepted_answers` non-empty and non-blank |
| `multiple_choice` | ≥2 choices; unique ids | name one known choice |
| `multiple_response` | ≥2 choices; unique ids; `required_selections` ≥2 and ≤ choices | known, non-duplicated choices; count == `required_selections` |
| `python_code` | `language == "python"`; `entrypoint` (if set) a valid Python identifier; starter non-empty and ≤20,000 bytes; ≤4 packages from `{numpy, pandas, matplotlib}`; 1–50 tests; ≤16 args/test; serialized arg/expected ≤8,000 bytes; expected stdout ≤8,000 bytes; `raises` exception a valid identifier; call/raises tests need an entrypoint | tests valid (validated with the interaction) |

## 1.2 Learning domains (`crates/content/src/learning.rs`)

- Metadata: `schema_version`, `content_version`, `certification_id`, `certification_version` non-empty; domain `id`/`name` non-empty and weight ∈ `(0, 1]`; `learning_design.{progress_label, unlock_rule, mastery_note}` non-empty; ≥1 source reference with `title` + `url`.
- Modules: ≥1; `id`/`title` non-empty and unique; positive, unique `order`; ≥1 node; prerequisites not self and must exist; no module cycle.
- Nodes: ids globally unique; `id`/`title` non-empty; ≥1 concept; `map_position` finite and ∈ `[0,1]`; prerequisites not self and must exist; no node cycle; node-level source refs (when present) valid; node glossary terms non-empty and unique within the list.
- Prompts: ≥1 per node and ≥1 required; ids unique; `label` non-empty.
- Reveals must be complete for `text`, `sequence`, `bullets`, `keywords`, `comparison`, `table`, `code_file` — including progressive `table` row/column/cell rules, progressive `text` spans (unique ids, text present, valid occurrence, no overlap), and `code_file` anchors (non-empty filename/language/code, unique annotation ids, valid 1-based line/occurrence, non-overlapping anchors, title and explanation present).
- `coverage` must match the authored shape exactly: `module_count`, `knowledge_node_count`, `prompt_count`, and the union of `task_ids`/`skill_ids`.

## 1.3 Practice tests (`crates/content/src/practice_test.rs`)

- `schema_version == "practice-test-v2"`; `id`/`title`/`exam_code`/`certification_version`/`content_version` non-empty; `time_limit_minutes > 0`.
- ≥1 item; `question_count == items.len()`; `order` unique and contiguous `1..=N`; question ids unique; question `id`/`prompt` non-empty; interaction type matches; `assessment_mode` a valid enum (parse-time); `difficulty_prior` in range; question `certification_version`/`content_version` match the test; when `question_types` is declared, every item type appears in it.
- Each item's `interaction` and `canonical_answer` use the same structural rules as quiz questions.
- Items are **not** required to declare concepts, `error_codes`, or `source_refs`; the editorial fact-check gate still requires a source for any factual claim.

## 1.4 Cross-source checks (`crates/content/src/registry.rs`)

- Bundles sharing a certification version merge by id (concepts, questions, domains, tasks; later wins).
- Every task's questions must share one `content_version` (`task_content_version_mixed`).
- **Learning ↔ bundle:** the domain exists in the version; its weight equals the blueprint weight; every node concept id exists; every module task id exists.
- **Practice test ↔ bundle:** `exam_code` matches the certification; every item `domain_id` exists.
- No duplicate learning domain (cert + version + domain) or practice-test id.
- Invalid JSON is reported per file (`invalid_json`, `invalid_learning_json`, `invalid_practice_test_json`); if no bundle parses at all, `no_content`.

## 1.5 Not checked automatically (manual audit required)

Part 1 is the authoritative list of what is checked automatically; everything below is a manual responsibility.

Factual accuracy and currency; source quality/authority/relevance; teach-before-test; natural English, tone, ambiguity, readability; distractor plausibility; **answer predictability**; semantic duplication; interaction run length; coverage relevance beyond ids, weights, and counts. These are why Parts 2–4 exist.

---

# Part 2 — Editorial gates

## 2.1 Fact-check and source references (hard gate)

Every factual claim is verified against an authoritative source before it ships. A structurally valid bundle with a wrong fact is still wrong.

**What to fact-check:** every definition, mental model, comparison, table, code sample, and example; every stem, option, answer key, explanation, hint, and per-choice feedback; every "wrong because…" distractor rationale; any number, limit, default, quota, price, region/SKU/release-availability, or deprecation/rename statement.

**Source authority (prefer in order):** vendor exam guide/objectives (the scope authority) → official product/language/framework docs → standards or peer-reviewed literature → well-attributed secondary sources (only if primary is unavailable). **Never:** leaked exam dumps, copied proprietary banks, unattributed blogs, forum answers, or model memory.

**Reference requirements**

- Every scored question carries ≥1 `source_refs` entry (the validator enforces presence, title, and URL; humans verify quality).
- Every learning domain references ≥1 source (`learning_source_refs_missing`); node-level references are optional but recommended for non-obvious claims.
- Point at the exact page/section, name it, and record the revision/date checked; prefer stable vendor URLs; a nuanced claim may need several references.
- Record the exam `effective_date`, `content_version`, and `last_reviewed` so a later blueprint change can be diffed.

**Checklist**

- [ ] The source supports the exact wording (not a nearby, looser claim).
- [ ] The source is current for this exam version and its `effective_date`.
- [ ] No renamed/deprecated service, API, flag, or default has crept in.
- [ ] Numbers/limits/quotas/prices are correct or intentionally avoided; retained specifics are date-stamped.
- [ ] Region/SKU/feature-availability statements are accurate.
- [ ] Distractors are wrong for a real, statable requirement — not invented.
- [ ] Explanations do not teach a shortcut the source contradicts.
- [ ] Trademark/endorsement wording is accurate (no implied vendor endorsement).

If a claim cannot be sourced, remove it or rewrite it to something that can.

## 2.2 Natural English and readability

Wording is an editorial gate; the validator never reads for meaning. Review every learner-facing string: titles, definitions, tables, code comments, prompts, options, explanations, hints, feedback, buttons, and instructions.

**Read-aloud test:** read each string as if explaining it to one learner. If it sounds like a specification, a legal notice, or a machine wrote it, rewrite it. Ask: *would a knowledgeable instructor naturally say this?*

**Rules**

1. One new technical idea per sentence.
2. Active voice and concrete verbs.
3. Define terms and acronyms on first use.
4. Keep definition blocks short.
5. Put a short example immediately after an abstract statement.
6. Use one term per concept everywhere.
7. Put the key rule before edge cases.
8. Avoid long noun-heavy sentences.
9. Avoid unexplained jargon.
10. Don't require memory of several earlier cards.
11. Break multi-step explanations into distinct steps.
12. Don't bury the conclusion at the end of a long paragraph.
13. Use whitespace and progressive disclosure.
14. Prefer one decision per interaction.
15. State the requested action explicitly (for example `Choose ONE.`).
16. Keep option wording parallel to the stem.

**Failures to catch:** textbook compression; noun stacking (`Azure virtual network gateway subnet route table association`); undefined acronyms; ambiguous pronouns; multi-idea sentences; nominalizations (`perform a validation of`); passive voice; vague instructions; one concept named two ways or one word for two concepts; idioms/culture/region phrasing; double negatives.

- **Prefer:** "A generator produces values one at a time. It does not build the whole result in memory first."
- **Avoid:** "Generators provide lazy iteration semantics by suspending function execution while preserving local state between successive resumptions."

**Question-specific:** the stem is answerable on its own; avoid `all/none of the above` unless explicitly valid; grammar never leaks the answer; options are parallel and similar in length; no trick wording, double negatives, or gotchas; distractors stay plausible and respectful.

## 2.3 Teach-before-test (hard gate)

Every scored question maps to content actually taught first, unless it is explicitly diagnostic: `question → learning node → real explanation exists`. Metadata alignment (`question.concept_id == learning.concept_id`) is **not** sufficient. If a question needs an unexplained term/service/concept, add the content or remove/replace the question.

---

# Part 3 — Audit 1: Learning Material

## 3.1 Goals

For every Learning Track, ask:

1. Does the material cover the knowledge the track's scope requires?
2. Is every title/topic defined before the learner must use it?
3. Are important products, services, tools, resources, APIs, concepts, commands, and terms explained in plain language?
4. Are acronyms and specialized terms defined before reuse?
5. Does it teach how similar concepts/tools/resources differ and when to choose each?
6. Is the wording natural, concrete, and easy to parse?
7. Is it readable for learners with ADHD, working-memory limits, or comprehension difficulties?
8. Does it teach what the quizzes later test?
9. Are important knowledge gaps present?
10. Can missing knowledge be added without low-value memorization or unnecessary detail?
11. Does each topic explain both **what it is** and **why/when it matters**?
12. Is the difficulty right for the learner's stage, without assuming undocumented prerequisites?

## 3.2 Scope and source of truth

Define the track's scope authority: official exam guide/objectives, official curriculum, product docs, language/framework docs, published syllabus, project competency map, or research literature. Record the primary scope source, supporting sources, version/revision/date, and changes since the last release. The primary source wins over supporting material. Never silently extend the curriculum because a topic is interesting.

Each non-obvious claim must be traceable to a specific source: exact page/section (not the docs home), revision/date and applicable exam `effective_date`, primary over secondary, and update/remove stale references. The validator only checks presence, not correctness — see Part 2.1.

## 3.3 Coverage (three levels)

- **Scope:** does every required domain/objective/skill/competency appear?
- **Teaching:** presence in metadata ≠ explained. Required concept → learning node → definition → purpose/use → mental model/example → retrieval/application. (`concept_id` with no meaningful explanation is a failure.)
- **Depth:** enough detail for the track's decisions. Avoid both extremes — too shallow (`"Redis is a cache."`) and too deep (details that never change a learner decision). Target: the minimum sufficient depth for correct reasoning.

## 3.4 Definition-first (hard authoring rule)

Define the title/topic before asking the learner to compare, configure, troubleshoot, or recall it. Test: *if the learner knows nothing about the words in this title, can they understand the first reveal?* If not, add a definition.

Example: a node titled "Operational signals" whose first reveal is "Metrics vs logs vs events" assumes the term. Define it first ("data that shows what is happening inside or around a system"), give examples (metrics, logs, events, traces, audit records), then compare. The same applies to any term: Python iterator, tensor, gradient, Terraform provider, Kubernetes controller, IAM role, vector embedding, cache key, regularization, attention head.

## 3.5 Named technologies

When introducing a named technology, service, library, resource, API, or feature, explain: **what is it; what problem does it solve; what does it actually do; when would I use it; what is it commonly confused with.** Examples: Amazon SNS, Terraform provider, PyTorch DataLoader, Python generator, Kubernetes Deployment, PCA, Redis, EventBridge. Do not assume ecosystem jargon.

## 3.6 Similar-concept differentiation

Identify concepts learners commonly confuse; teach how they differ, when to choose each, the clue that points to one, and what the alternative is for.

- **Cloud/infra:** metric vs log vs trace; queue vs pub/sub; security group vs network ACL; VM image vs volume snapshot; rolling vs blue/green deployment.
- **Python:** list vs tuple; iterator vs iterable; generator vs regular function; `map` vs list comprehension; shallow vs deep copy.
- **Data/ML:** classification vs regression; precision vs recall; PCA vs feature selection; K-Means vs DBSCAN; validation set vs test set.
- **Deep learning:** epoch vs batch vs iteration; training vs inference; loss vs metric; dropout vs batch normalization; encoder vs decoder.
- **Terraform:** provider vs resource; variable vs local; `count` vs `for_each`; state vs configuration; plan vs apply.

Required comparison structure: basic distinction; when-to-use comparison; one realistic scenario; the common wrong choice and why it does not fit.

## 3.7 Node structure

Prefer: **definition** (1–2 sentences) → **why it matters** (one concrete practical reason) → **core mental model** (one of table, sequence, diagram, code example, worked example, concrete scenario) → **when to use it** (one realistic case) → **do not confuse it with** (only when there is a meaningful similar concept) → **recognition clue** (exam clue, or practical/code/symptom clue) → **micro-retrieval** (one short check).

## 3.8 Progressive reveal

Reveal complements explanation, never replaces it. Use `definition → purpose → progressive table/code/sequence`. Avoid `undefined title → large table → learner infers the concept`. Tables suit comparison, mapping, trade-offs, and structured recall; code views suit syntax, important lines, configuration, and tracing behavior; sequences suit workflows, lifecycle, request paths, and procedural reasoning.

## 3.9 Scope control

Do not turn a track into an encyclopedia. Avoid unnecessary memorization of obscure limits, exact prices, rarely used API names, decision-irrelevant implementation details, long feature lists, and out-of-scope edge cases. Add content only when it improves required coverage, conceptual understanding, discrimination between similar ideas, troubleshooting, applied decision making, or transfer to realistic tasks.

## 3.10 Learning-material checklist

A learning node is complete only when:

- [ ] every factual claim is verified against an authoritative source (fact-check);
- [ ] the domain (and, where useful, each node) has source references with exact links and the revision/date checked;
- [ ] the title/topic is defined;
- [ ] technical terms are defined before reuse;
- [ ] the learner understands why the topic matters;
- [ ] named tools/services/resources have a plain-language purpose;
- [ ] the learner knows when to use the concept;
- [ ] similar concepts are compared where relevant;
- [ ] there is at least one concrete example or scenario;
- [ ] wording passes the natural-English read-aloud test and is concise;
- [ ] progressive reveal does not replace basic explanation;
- [ ] the node does not assume undocumented prerequisite knowledge;
- [ ] quiz-tested concepts are actually taught;
- [ ] content stays within the intended track depth.

---

# Part 4 — Audit 2: Questions

## 4.1 Goals

For every question bank, ask:

1. Does each question test knowledge that matters for the track?
2. Was the concept taught first?
3. Does it test useful reasoning rather than trivia?
4. Does the bank test differences between similar concepts/tools/resources?
5. Does it test **when to use** something, not only what it is?
6. Are realistic application/troubleshooting questions present?
7. Are distractors plausible?
8. Does wrong-answer feedback teach from mistakes?
9. Is interaction-type variety sufficient?
10. Is the same interaction type shown no more than twice in a row?
11. Are semantically duplicate questions spaced apart?
12. Is the reading burden appropriate?
13. Does the sequence alternate cognitive demands to prevent fatigue?
14. Are low-level recall questions balanced with application questions?
15. Are high-frequency/important concepts represented proportionally?
16. Can the correct answer be guessed from position or surface features instead of understanding? (See 4.15.)

## 4.2 Relevance

Good reasons for a question: required objective; important decision rule; commonly confused concept; common operational failure; core syntax/API usage; realistic application; retrieval of a foundational fact. Bad reasons: filling question-count targets; trivial wording variation; obscure details with little practical value; repeating the same distinction consecutively.

## 4.3 Interaction sequencing

**Rule:** never show the same `interaction_type` more than two questions consecutively when another valid question is available. Interaction types: classification, ordering, node_connection, reconstruction, evidence_selection, spot_the_fault, fill_slots, troubleshooting, scenario_choice_chain, configuration_builder, two_dimensional_placement, command_assembly, typed_fill_blank, python_code.

**Not machine-enforced today.** This is a human-audit rule; the validator checks structure, references, and canonical answers only, and does not inspect run length. (A future validator rule could flag `run_length(interaction_type) > 2`.) The runtime selector should prefer another type when the last two share one, and fall back to repetition rather than fail mission generation.

## 4.4 Semantic repetition

Different interaction types can still ask essentially the same thing:

```text
Q1 Classify Multi-AZ as high availability.
Q2 Connect Multi-AZ → failover.
Q3 Fill in: Multi-AZ primarily provides _____.
```

The UI changes; the cognitive task barely does. Better: recall → a different concept → application of the original → troubleshooting → comparison against a plausible alternative.

**Rule:** avoid adjacent questions sharing the same primary concept, the same decision rule, or the same scenario shape. Intentional remediation after a wrong answer is allowed, but the retry must change the framing.

## 4.5 Cognitive variety

A strong quiz mixes recognition, recall, application, structural reconstruction, relationship recall, procedural recall, and troubleshooting/evidence reasoning. Do not let a bank become mostly one type even if the content technically varies.

## 4.6 Similar-concept questions

Test important confusing concepts explicitly. For each important pair/group aim for: a **basic distinction**, a **when-to-use scenario**, and a **plausible-distractor scenario**.

- **Python:** list vs tuple; iterator vs iterable; generator vs list.
- **ML:** precision vs recall; classification vs regression; K-Means vs DBSCAN.
- **Cloud:** queue vs pub/sub; Multi-AZ vs read replica; ALB vs NLB; Config vs CloudTrail.
- **Terraform:** `count` vs `for_each`; variable vs local; state vs configuration.

Prefer "Which option fits this requirement, and why?" over "What is X?".

## 4.7 Scenario quality

Scenarios should state the relevant requirement, include only the evidence needed for the decision, use realistic terminology, contain plausible alternatives, and have one clearly strongest answer under the stated conditions. Avoid fake complexity, irrelevant company names, long prose that tests reading endurance, trick wording, and obviously unrelated distractors.

## 4.8 ADHD-friendly question design

Learning-mode questions should test knowledge, not decoding effort. Prefer structured stems:

```text
Requirement: …        |  Symptom: …
Current state: …      |  Evidence: …
What should you do?   |  Choose the next step.
```

Reserve exam-like or verbose scenario wording for full practice, exam simulation, and higher difficulty.

## 4.9 Wrong-answer feedback

Every scored question needs a useful explanation. For an incorrect answer, give: (1) why the learner's choice does not fit; (2) why the correct answer fits; (3) the rule to remember.

> **You chose a read replica.** It adds read capacity and is not the standard choice for managed synchronous HA failover. **Correct: Multi-AZ** — designed for high availability and managed failover. **Remember:** Multi-AZ = availability; read replica = read scaling.

Avoid explanations that merely repeat the correct answer.

## 4.10 Hints

Hints guide reasoning without giving the answer. Good: "Ask whether the requirement is availability or read scaling." Poor: "Choose Multi-AZ." They are most useful for scenario chains, troubleshooting, configuration builders, structural reconstruction, and first exposure to a new interaction type. Easy recall questions do not always need one.

## 4.11 Distractors

Distractors should be technically plausible, related to the same problem space, and wrong because of a specific requirement mismatch. Bad: a database-HA question with CloudFront. Good: read replica — because learners genuinely confuse the two.

## 4.12 Bank balance

Do not optimize for raw question count. Optimize for scope coverage, conceptual diversity, interaction diversity, realistic decisions, spaced retrieval, and useful mistakes. A smaller set of strong questions beats many near-duplicates.

## 4.13 Runtime adaptive selection

The selector should consider concept weakness; forgetting/recency; domain/objective coverage; difficulty fit; assessment mode; interaction type; recent concept history; and recent scenario shape. Prefer: ≤2 same interaction types in a row; no immediate semantic duplicate; no repeated concept unless remediation requires it; a mix of recall and application; and alternating textual with manipulation-heavy interactions when practical.

## 4.14 Audit metrics

Report at least:

- **Coverage:** total questions; questions by domain/module/objective; questions per concept; concepts tested but not taught; taught concepts never tested.
- **Interaction diversity:** questions by interaction type; longest same-type run; count of 3+ same-type runs; share of the dominant type.
- **Assessment diversity:** questions by assessment mode; recall vs application balance; troubleshooting/scenario coverage.
- **Feedback quality:** questions with explanations; questions with hints; questions with targeted wrong-answer explanations if supported.
- **Semantic duplication:** repeated primary concept in adjacent questions; nearly identical prompts; the same rule tested with only wording changes.
- **Answer predictability:** position census (share of each correct-answer slot) and the blind-guess result (see 4.15).

## 4.15 Answer predictability (hard gate)

A bank is **predictable** when a learner can choose correctly without understanding by exploiting a pattern. Predictability is a correctness bug: it inflates scores, hides real gaps, and corrupts mastery estimates — the learner beats the pattern and the system records success. The validator checks none of this; it is a manual gate. There are two forms:

1. **Positional predictability** — the correct answer sits in a predictable slot.
2. **Content predictability** — the correct answer is identifiable from surface features wherever it sits.

**Positional rule:** across a bank, the correct answer must not occupy a fixed or near-fixed position; no position may be correct far more often than chance.

Worked failure — a `troubleshooting`/`scenario_choice_chain` where the correct choice is first at every step:

```text
Step 1  [correct] [distractor] [distractor]
Step 2  [correct] [distractor] [distractor]
Step 3  [correct] [distractor] [distractor]
```

A learner who always taps the first option completes the chain without reading. Varying only the question but not the position does not fix it. Per-type positional failures:

- `multiple_choice`: the key is always option A, always last, or always the same index.
- `multiple_response`: the correct set is always the first N, or always the two longest.
- `troubleshooting`/`scenario_choice_chain`: the correct index is the same at every step, or the same index is correct across most questions.
- `classification`: items always belong to the first listed category, or the correct category is always in a fixed position.
- `ordering`: authored items are written in canonical order, so the authored artifact is pre-solved (the client's seeded shuffle is then the only thing preventing a pre-solved list).
- `fill_slots`/`configuration_builder`/`command_assembly`/`reconstruction`: the correct option is always first in the palette, or the first slot always takes the first option.
- `node_connection`: canonical edges always run first→second, first→third.
- `evidence_selection`/`spot_the_fault`: the relevant or faulty ids are always the first N.
- `two_dimensional_placement`: every item lands on the main diagonal.

**What the app shuffles — and why authored position still matters.** Display-shuffled, seeded per question/step: `multiple_choice`, `multiple_response` (`shuffledChoices`); `ordering` (seeded `shuffledOrder`); `troubleshooting`/`scenario_choice_chain` (each step's choices); `reconstruction` palette (`stableShuffle`). Rendered in **authored order**: `classification` items/categories; `fill_slots` options, `configuration_builder` pieces, `command_assembly` tokens; `evidence_selection` evidence and `spot_the_fault` elements; `two_dimensional_placement` items/palette. For those, authored order *is* displayed order. Even on shuffled surfaces, shuffling is a display concern that can change or be disabled, and content predictability survives it entirely. **Author as if position is always visible, and audit the authored order.**

**Content predictability** (flag when systematic): key always longest or shortest; key always most specific/technical/detailed; key the only option echoing the stem; key the only option with a qualifier while distractors are bare; absolutes (`always`, `never`, `all`, `none`) only in distractors; distractors obviously unrelated or absurd; distractors grammatically inconsistent with the stem while the key fits; for "choose TWO", the only plausible pair; key the only full sentence (or the reverse); `typed_fill_blank` answer guessable from the slot label or template; `evidence_selection` relevant ids always first N; `spot_the_fault` faulty element always first or last row.

**How to audit:** position census by type (flag any slot far above `1/N`); chain census (modal correct index across steps/questions); length bias (count questions where the key is uniquely longest/shortest); absolute-word asymmetry (distractors vs keys); parallelism (grammar, length, specificity); unshuffled palettes; and a blind-guess test (hide options, predict from the stem; hide the stem, predict from option shape — if either works consistently, it is predictable).

**Fixing it:** vary the key's authored position; balance positions across the bank and within each type; vary the correct index step to step in chains; equalize distractor length/grammar/specificity; distribute qualifiers and absolutes across options; ensure the key is not the only technical or stem-echoing option; vary the palette position on unshuffled surfaces. Do not overcorrect — "always put the key second" is the same bug with a new index.

**Checklist**

- [ ] correct-answer positions are spread across the bank, not clustered;
- [ ] no position is used far above chance for any interaction type;
- [ ] scenario/troubleshooting chains vary the correct index across steps;
- [ ] the key is not systematically the longest, shortest, or most detailed option;
- [ ] distractors match the key in length, grammar, and specificity;
- [ ] absolutes and qualifiers are not concentrated in distractors only;
- [ ] unshuffled tactile palettes do not always put the correct option first;
- [ ] `typed_fill_blank` answers are not guessable from the label or template;
- [ ] the blind-guess test fails (the key cannot be picked without reading).

## 4.16 Question acceptance checklist

A question is complete only when:

- [ ] the stem, options, key, explanation, hint, and feedback are fact-checked against an authoritative source;
- [ ] it carries at least one accurate source reference (non-empty title and a working URL supporting the exact claim);
- [ ] it tests relevant knowledge;
- [ ] the concept was taught first;
- [ ] wording is natural English, unambiguous, and free of stacked nouns or unexplained jargon (read-aloud test);
- [ ] the stem is answerable on its own and does not leak the answer through grammar or option length;
- [ ] the correct answer is not guessable from position or surface features (see 4.15);
- [ ] the task is clear;
- [ ] distractors are plausible and wrong for a statable requirement;
- [ ] the correct answer is clearly superior;
- [ ] similar concepts are differentiated where relevant;
- [ ] the explanation teaches the reasoning;
- [ ] common wrong choices can be explained;
- [ ] it does not create a third identical interaction type in a row;
- [ ] it is not semantically redundant with adjacent questions;
- [ ] it stays within intended track scope;
- [ ] its reading burden matches the quiz mode/difficulty.

## 4.17 Pedagogical metadata audit (only when authored)

`pedagogy` is optional. These checks apply **only** to questions that use it;
old tracks without the metadata are not required to add it.

- [ ] `family_id` names a genuinely shared deeper structure — the same pattern,
      strategy, or conceptual family would describe every member, not just this
      question's surface wording.
- [ ] `stage` accurately describes what the learner is actually doing
      (`recognize` for identification, `diagnose` for fault-finding,
      `construct` for building, `transfer` for applying the structure in a
      substantially different context, and so on).
- [ ] `scaffold_level` reflects the help actually embedded in the activity
      (`0` none … `6` strongly guided), independent of `difficulty_prior`.
- [ ] `surface_context` is not misleading: it names the domain/story the learner
      sees, not a hidden hint at the answer.
- [ ] every `transfer_group_id` member really exercises the same underlying
      structure in a different surface context.
- [ ] every `challenge_group_id` member genuinely belongs together as one
      intended multi-stage journey.
- [ ] pedagogy metadata is not used to reveal the intended approach before
      scoring (it is authored and server-side only).

---

# Part 5 — Audit output format

Every audit produces two sections: **Learning Material Audit** and **Questions Audit**. Each includes: summary; strengths; factual-accuracy findings and source-reference quality (link, currency, authority); coverage gaps; terminology/definition issues; confusing-concept comparisons; readability/ADHD issues; natural-English/wording issues; teach-before-test gaps; additions/removals/replacements; prioritized action list.

Question audits also include: interaction-type distribution; same-type run violations; semantic duplication; scenario/troubleshooting coverage; feedback/hint quality; answer predictability (position census, content cues, blind-guess test).

Report any automated-validation failure (`ContentError` code + source path) verbatim **before** the editorial findings, since it blocks content from loading at all.

---

# Part 6 — Priority order for future audits

**Learning material:** 1) fact-check every claim against the primary source; 2) repair/attach source references (exact link, authority, revision/date); 3) verify scope against the current source of truth; 4) add missing definitions; 5) explain tools/services/resources in plain language; 6) close teach→test gaps; 7) strengthen similar-concept comparisons; 8) rewrite compressed/awkward text (natural English); 9) improve examples and mental models; 10) add only high-value missing material.

**Questions:** 1) fact-check stems, keys, explanations, feedback, and distractors; 2) ensure accurate, working source references; 3) rewrite unnatural/ambiguous wording; 4) remove answer predictability (vary key positions, remove content cues); 5) remove/replace low-value repetition; 6) enforce interaction-type variety; 7) prevent semantic duplicates; 8) add application/troubleshooting scenarios; 9) strengthen similar-concept decisions; 10) improve wrong-answer feedback; 11) add questions only for genuine coverage/reasoning gaps.

---

# Core authoring principle

```text
DEFINE
↓
VERIFY (fact-check + attach source references)
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

Two gates sit above everything else: **fact-check and source references** (no claim ships without an authoritative, current source — the validator only checks that references exist; the human audit checks that they are true and relevant) and **natural English** (content that passes every structural check but reads like a machine has not passed the audit; read it aloud and rewrite if an instructor would not say it that way).
