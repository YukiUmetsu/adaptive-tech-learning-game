# Certification Content

## Goal model

A campaign is tied to a **versioned exam blueprint**.

```text
Certification
└── ExamVersion
    ├── effective dates
    ├── official objectives
    ├── objective weights
    ├── concepts
    ├── prerequisite graph
    └── question/content bundle versions
```

Reason: certification vendors change objectives. Mastery history must remain interpretable after an exam revision.

## Initial content strategy

Start with 1-2 certifications where:

- official objectives are explicit
- concepts overlap with reusable technical knowledge
- learner demand is high
- content can be authored/tested without proprietary exam dumps

Do not start with six ecosystems simultaneously.

Current authored content lives under `content/<category>/<certification>/<version>/`
and is surfaced through the API catalog plus `apps/web/src/state/catalogMeta.ts`:
AWS SOA-C03, SAA-C03, and AIP-C01; Microsoft AZ-900 and AZ-104; CompTIA
Security+ SY0-701; HashiCorp Terraform Associate 004; and the AI/Python tracks
(Python fluency, Python data stack, PyTorch core). Demo bundles live under
`content/demo/`. Each certification also ships learning knowledge maps alongside
its scored question bundles.

## Content sources

Allowed:

- official exam guides/objectives
- official product/service documentation
- original explanations
- original practice questions
- public standards/specifications where licensing permits

Do not ingest:

- leaked exam dumps
- copied proprietary questions
- copyrighted course banks without permission

## Knowledge graph

Example:

```mermaid
graph TD
    Net[Networking basics] --> VPC[AWS VPC]
    VPC --> Route[Route tables]
    VPC --> SG[Security groups]
    Route --> NAT[NAT gateway]
    IAM[IAM basics] --> Policy[IAM policies]
    Policy --> Cond[Policy conditions]
    CW[CloudWatch basics] --> Alarm[Alarms]
    Alarm --> Ops[Operational response]
```

Prerequisites help distinguish:

> "forgot target concept"

from:

> "target mistakes are driven by a weak prerequisite"

## Question authoring schema

Each question needs:

```text
id
exam version
objective
concept weights
assessment mode
interaction type
difficulty prior
prompt/content
correct structure
structured error codes
explanation
hints
source references
```

### Optional pedagogical metadata

A question may also carry an optional, track-agnostic `pedagogy` object. It is
descriptive in Phase 1 (it never changes mastery, scoring, rewards, or
selection) and every field is optional, so existing content keeps loading
unchanged.

```jsonc
"pedagogy": {
  "family_id": "aws.storage.cost_latency_tradeoff", // reusable pattern (opaque)
  "stage": "differentiate",                          // PedagogyStage
  "scaffold_level": 2,                               // 0..=6 embedded help
  "transfer_group_id": "tradeoff_under_constraints", // opaque
  "surface_context": "order_processing",             // opaque
  "challenge_group_id": "storage-tradeoff-01"        // opaque
}
```

- `stage` is one of `discover`, `recognize`, `differentiate`, `reason`,
  `trace`, `diagnose`, `construct`, `transfer`.
- `scaffold_level` is how much help is embedded, **not** difficulty.
- `family_id`, `transfer_group_id`, `surface_context`, and `challenge_group_id`
  are author-defined strings; the validator rejects blank values when a field is
  present but does not constrain their contents or impose cross-question rules.

See [06-learning-engine.md](06-learning-engine.md#pedagogical-metadata-phase-1)
for the semantics and the intentional distinction between assessment mode,
pedagogy stage, difficulty, and scaffolding.

`pedagogy` is authored content. It is not sent in learner-facing question DTOs
before scoring, because some `family_id` values could reveal the intended
approach.

## Learning modules (knowledge maps)

Quiz bundles, learning content, and practice tests are distinct first-class
content types:

```text
content/<category>/<certification>/<version>/
├── learning/            # LearningDomain knowledge maps (pre-quiz)
│   └── learning-domain-1.json
├── questions/           # ContentBundle quiz content (scored, adaptive)
│   └── domain-1.json
└── practice-tests/      # practice-test-v2 fixed exam simulations
    └── practice-test-1.json
```

The build discovers learning sources by path (`**/learning/**/*.json`),
practice tests by `**/practice-tests/**/*.json`, and quiz sources as every
other JSON file, so none can be silently parsed as another. `ContentRegistry`
validates and exposes all three: quiz bundles, learning maps, and `PracticeTest`
values.

At runtime the API loads embedded content leniently: a file that fails to parse
or validate is skipped, and the error is logged with its repository-relative
path. Strict validation still runs in the test suite (`ContentRegistry::embedded`)
so bad content fails CI rather than reaching learners.

### Practice tests (`practice-test-v2`)

A practice test is a fixed, authored exam simulation, not an adaptive quiz:

- The item order is fixed and every question is presented exactly once.
- There is a wall-clock `time_limit_minutes`.
- No correctness, feedback, score, or reward is revealed until the whole
  attempt is submitted.
- Adaptive selection never runs against a practice test, and practice-test
  results never update concept mastery.

Each item wraps a shared `Question` in a `PracticeTestItem` that also carries the
exam-only fields: `order`, `is_scored`, and `scenario_style`. Exam concerns
(order, timer, hiding answers, scored/unscored visibility) stay on the
practice-test layer and never move onto the shared `Question`.

The embedded SOA-C03 test has 65 items: 50 scored and 15 authored unscored
simulation items. Only `is_scored = true` items count toward the practice score
and the per-domain breakdown; all totals are derived from the authored content,
never hardcoded. Before submission the learner-safe payload never reveals which
items are scored.

Practice-test questions may omit concept mappings (the current migration authors
none), which is why their results never feed mastery. `blueprint_skill_ids` are
official exam-objective references, never concept ids. If explicit concept
mappings are authored later, practice-test results can feed the learning model
then.

Canonical answers (`canonical_answer`, `choice_feedback`, `explanation`, and
`is_scored`) live only in server content. The API serves learner-safe DTOs
before submission and returns answers only in the submission response.

### Multiple choice and multiple response

`multiple_choice` and `multiple_response` are shared interaction types usable by
any content, adaptive or exam. `multiple_choice` carries `choices`;
`multiple_response` adds `required_selections`. Canonical scoring compares stable
choice ids and never depends on display order. A multiple-response answer is
scored as an exact set with no partial credit: a missing, extra, substituted, or
duplicate id is incorrect. Learners may leave a multiple-response question
partially selected during an exam and return later; the selection limit is
enforced only when selecting.

Each `LearningDomain` contains ordered `LearningModule`s of `KnowledgeNode`s.
A node carries `concept_ids` (the bridge to quiz evidence), authored
`prerequisite_node_ids` and `map_position`, and progressive `prompts` whose
`reveal` is one of `text`, `sequence`, `bullets`, `keywords`, `comparison`,
`table`, or `code_file`. A prompt's `placeholder` is optional: an ordinary
reveal with an empty placeholder shows a generic `?` blank, and an interactive
reveal simply omits the context line.

`table` is a real table with typed column ids and one row per record; every row
must fill every column. `code_file` is a read-only, syntax-highlighted file with
clickable annotation regions. Annotation anchors use a 1-based `line`, the exact
`text` on that line, and an optional 1-based `occurrence`, so authors never
hand-count offsets and the raw `code` stays valid and copyable. A code file is
never editable or executed. See `crates/content/src/learning.rs` for the
authoritative schema and validation.

A `LearningDomain` may carry a `glossary`: a list of `{ "term", "definition" }`
entries. A `KnowledgeNode` may also carry its own `glossary` for that page. When
a card renders, the node glossary is merged with the domain glossary and a node
term wins over a domain term with the same text, so a page can refine or
override a shared definition while keeping domain-wide terms available
everywhere. The app highlights each term where it appears in learner-facing
learning text (case-insensitive, whole words, and never inside a `code` span)
and reveals the definition when the learner activates it. Terms and definitions
must be non-empty and unique within one glossary. The glossary is explanation
only: it never affects discovery progress, scoring, or rewards.

A `table` may carry optional `progressive_reveal` to reveal discovery one row,
one column, or one cell at a time. Its `initially_visible` lists combine: a cell
is visible before any reveal when its column, its row, or its derived cell id
(`row_id:column_id`) is listed. The table renders immediately and already
visible cells never become reveal controls. A progressive table must set
`progressive_reveal.mode`; `row` and `cell` modes require every row to have a
stable `id`. Static tables omit `progressive_reveal` and keep the whole-table
reveal.

Example:

```json
{
  "type": "table",
  "columns": [
    { "id": "service", "label": "Service" },
    { "id": "purpose", "label": "Best for" }
  ],
  "rows": [
    { "id": "cloudwatch", "cells": { "service": "CloudWatch", "purpose": "Operational monitoring" } },
    { "id": "cloudtrail", "cells": { "service": "CloudTrail", "purpose": "API auditing" } }
  ],
  "progressive_reveal": {
    "mode": "cell",
    "initially_visible": {
      "column_ids": ["service"],
      "row_ids": [],
      "cell_ids": ["cloudtrail:purpose"]
    }
  }
}
```

A `text` reveal may carry optional `progressive_reveal` to hide individual words or
phrases inside the sentence and reveal them one at a time. The sentence itself is
always rendered; only the authored spans become inline reveal controls. Each span
has a stable `id`, the exact `text` to hide (which may be several words), an
optional 1-based `occurrence` for repeated wording, and an optional `required`
flag that defaults to `true`. Spans are located by exact text plus occurrence, so
repeated wording is unambiguous; spans may not overlap. A text reveal without
`progressive_reveal` keeps the whole-prompt reveal.

Example:

```json
{
  "type": "text",
  "text": "Security groups are stateful, while network ACLs are stateless.",
  "progressive_reveal": {
    "spans": [
      { "id": "sg-state", "text": "stateful", "required": true },
      { "id": "nacl-state", "text": "stateless", "required": true }
    ]
  }
}
```

Rules:

- Learning is a discovery layer before retrieval practice, not a fourth quiz
  mode. Reveals are **never** scored and do not create `learning_event` rows,
  including individual code-annotation reveals.
- Discovery progress (`adaptive-learn.learning-progress.v3` in local storage)
  stores revealed prompt ids and generic element-discovery ids. Code
  annotations, progressive-table rows, columns, and cells, and progressive-text
  spans share one namespaced structure: `annotation:<id>`, `row:<id>`,
  `column:<id>`, `cell:<row_id>:<column_id>`, `span:<id>`. A one-time,
  idempotent migration converts the v2
  key (prompt progress plus raw code-annotation ids, re-prefixed as
  `annotation:`) and the v1 key (prompt progress only) without losing discovery
  progress, then drops the legacy key. Node and module state are derived, so
  progress cannot drift from the curriculum and stale ids are ignored.
- A node is `unlocked` when every required prompt is completed. Authored
  prompts are always required: a hidden prompt must be revealed before the node
  completes, so completion (including its sound) never fires while authored text
  is still hidden. Optionality is reserved for individual reveal elements
  (annotations and text spans), where it never blocks completion. A `code_file`
  prompt completes when every annotation flagged `required` is revealed;
  optional annotations never block completion. A `code_file` with no required
  annotations (including an empty list) completes on an explicit mark-as-reviewed
  action. A progressive `table` completes when every non-given reveal unit is
  explored: hidden rows in `row` mode, hidden columns in `column` mode, or
  hidden cells in `cell` mode. A progressive `text` reveal completes when every
  span flagged `required` is revealed; optional spans never block completion,
  and a progressive text reveal with no required spans completes on an explicit
  mark-as-reviewed action. Static tables and ordinary text reveals complete on
  the whole-prompt
  reveal. `ready`, `in_progress`, and `locked` are derived from node
  prerequisites, module prerequisites, and reveals.
- Vocabulary stays game-like: Knowledge Map, Knowledge Node, Locked, Ready,
  Discover, Unlocked, Path Unlocked, Module Complete, Continue Exploring,
  Discovery Progress. Do not say "Mastered" for exploration.
- The API exposes it at
  `GET /v1/certifications/{certification_id}/domains/{domain_id}/learning`.
  Reveals are included because progressive disclosure is the mechanic; quiz
  canonical answers are never included.

Validation fails loudly on malformed maps: duplicate module/node/prompt ids,
unknown or self prerequisites, dependency cycles, invalid map positions,
missing required prompts, incomplete reveal payloads, coverage counts that do
not match the authored shape, and concept/task ids that do not exist in the
quiz bundle for the same certification version. For `table` reveals it rejects
empty columns/rows, duplicate column ids, unknown columns referenced by a row,
and rows missing a column. For progressive tables it also rejects duplicate or
empty needed row ids, unknown or duplicate `initially_visible` entries, cell ids
that do not resolve to a row and column, colliding reveal-unit ids, and a table
whose initial visibility leaves nothing to reveal. For `code_file` reveals it
rejects empty filename/language/code, duplicate annotation ids, duplicate
anchors, overlapping annotation ranges, missing titles/explanations, anchors on
lines outside the code, target text that does not occur on its line, and
out-of-range occurrences. For
progressive `text` reveals it rejects empty span lists, duplicate or empty span
ids, empty span text, span text that does not occur in the sentence, out-of-range
occurrences, and overlapping spans.

## Interaction schema

Interactions are authored as Serde-tagged JSON. `interaction` and
`canonical_answer` share a `type` discriminator:

| `type` | Assessment mode | Learner task |
|---|---|---|
| `classification` | recognition | place items into categories |
| `ordering` | procedural_recall | arrange items in order |
| `node_connection` | relationship_recall | draw directed relationships |
| `reconstruction` | structural_reconstruction | place pieces into a slot-based scaffold |
| `evidence_selection` | application | select the relevant evidence sources |
| `spot_the_fault` | application | flag the faulty configuration element(s) |
| `fill_slots` | recall / procedural_recall | fill blanks from a constrained option set |
| `troubleshooting` | application | work through a diagnosis/remediation decision tree |
| `scenario_choice_chain` | application | work through an authored decision chain |
| `configuration_builder` | application | assign components to named roles |
| `two_dimensional_placement` | application | place items on a two-axis conceptual map |
| `command_assembly` | procedural_recall | assemble an ordered statement from tokens |
| `typed_fill_blank` | recall | type missing text into prose, code, or table blanks |

Design constraints:

- `interaction` never contains the answer key; `canonical_answer` is only
  returned after server-side scoring.
- Answer values are ids, never free text, except `typed_fill_blank`. That type
  grades free text deterministically against explicitly authored aliases; every
  other interaction submits ids. No runtime LLM grading is used.
- Component pools, options, and evidence lists may contain distractors.
  Learner-facing labels must never encode answer metadata such as
  `(distractor)`, `(correct)`, or `(wrong)`.
- Choice options and branching decisions are shuffled deterministically for
  display, seeded per question and step. Authors frequently list the correct
  option first, so the authored first option is never rendered first. Scoring
  is always by id, never by position.
- Every interaction must have a non-drag alternative and must not signal
  correctness by color alone.
- Branching interactions are deterministic; the client collects the learner's
  decision path locally and the server validates it against authored
  transitions. No per-step network call is made.
- Boss battles are a **composition** of normal interactions grouped by the
  mission layer, not an `Interaction` variant. This keeps a separate evidence
  signal for each skill.

Scoring is server-authoritative and partial where it produces useful evidence:

- `classification`: correct placements / items.
- `ordering`: correct positions.
- `node_connection`: correct edges minus invalid edges.
- `reconstruction`: for a `linear` scaffold, correctly filled slots divided by
  required slots — slot order encodes relationships, so no edges are required
  and unused distractors are never penalized. For a `graph` scaffold, authored
  slot positions are only a display scaffold: placement score is the number of
  required pieces present (wherever they sit), so swapping two pieces between
  slots is not penalized when the relationships are unchanged. Placement and
  topology are combined as `0.7 * placements + 0.3 * topology`, where topology
  is correct edges minus invalid edges. Structured errors distinguish
  `reconstruction_wrong_component`, `reconstruction_wrong_position` (linear
  only), `reconstruction_missing_component`, `reconstruction_unfilled_slot`,
  and, for graph layouts, `reconstruction_missing_relationship` /
  `reconstruction_invalid_relationship`.
- `evidence_selection`: correct selections minus false positives, over the
  number of relevant sources.
- `spot_the_fault`: faults found minus false positives, over the number of
  faults.
- `fill_slots`: correct slots / slots.
- `troubleshooting` / `scenario_choice_chain`: correct decisions minus wrong
  decisions, over the length of the expected path. Error codes are namespaced
  per stage (`*_wrong_diagnosis`, `*_wrong_next_action`, `*_wrong_remediation`)
  plus `*_incomplete_path`.
- `configuration_builder`: correct role assignments minus unnecessary
  components, over the number of required roles.
- `two_dimensional_placement`: correct item-axis placements over all
  item-axis pairs, using tolerant canonical regions rather than exact points.
- `command_assembly`: correct slots / slots, with separate codes for wrong
  tokens, missing tokens, and tokens in the wrong position.
- `typed_fill_blank`: correct blanks / blanks. A blank is correct only when its
  normalized typed answer exactly matches one of the authored accepted answers.
  All blanks must be correct for the whole question to be correct. Error codes
  are `typed_fill_blank_incorrect` and `typed_fill_blank_incomplete`.

## Typed fill in the blank

`typed_fill_blank` tests active recall: the learner types the missing word,
phrase, service, value, or code directly into one or more blanks. Use
`assessment_mode: "recall"`.

Presentation is explicit and tagged. The renderer never guesses whether content
is prose, code, or a table; `interaction.content.type` selects one of three
presentation contexts:

| `content.type` | Use |
|---|---|
| `text` | prose with `{{slot_id}}` blanks |
| `code` | syntax-highlighted source code with `{{slot_id}}` blanks |
| `table` | a table whose cells are `text` or `code` templates |

Blanks are always written as `{{slot_id}}` inside a template. Across all
templates of one interaction, each placeholder must resolve to a declared slot,
each slot must appear **exactly once**, and `canonical_answer.answers` must
contain exactly those slot ids. Repeated placeholder references are rejected
rather than silently binding two inputs to one answer.

### Text

```json
{
  "assessment_mode": "recall",
  "interaction_type": "typed_fill_blank",
  "prompt": "Complete the statement.",
  "interaction": {
    "type": "typed_fill_blank",
    "content": {
      "type": "text",
      "template": "An explicit {{policy_result}} overrides an Allow during IAM policy evaluation."
    },
    "slots": [
      {
        "id": "policy_result",
        "label": "Policy result",
        "placeholder": "Type your answer"
      }
    ]
  },
  "canonical_answer": {
    "type": "typed_fill_blank",
    "answers": {
      "policy_result": { "accepted_answers": ["deny", "explicit deny"] }
    }
  }
}
```

### Code

Code templates preserve newlines and indentation. `language` selects the
highlighter grammar and must not be blank.

```json
{
  "interaction": {
    "type": "typed_fill_blank",
    "content": {
      "type": "code",
      "language": "python",
      "template": "optimizer.{{zero}}()\nloss.backward()\noptimizer.{{step}}()"
    },
    "slots": [
      { "id": "zero", "label": "Clear gradients", "placeholder": "method" },
      { "id": "step", "label": "Update parameters", "placeholder": "method" }
    ]
  },
  "canonical_answer": {
    "type": "typed_fill_blank",
    "answers": {
      "zero": { "accepted_answers": ["zero_grad"] },
      "step": { "accepted_answers": ["step"] }
    }
  }
}
```

Blanks may sit inside function arguments, strings, or with punctuation touching
them (`dim={{dim}}`). The blank is rendered exactly where `{{slot_id}}` appears
inside the highlighted code, never as a separate field below it.

A bare `}}` that is not part of a placeholder is treated as literal text, so
code that naturally contains closing braces (nested dictionaries, blocks) is
valid. Only an unterminated or malformed `{{...}}` is rejected.

### Table

Tables render as real `<table>` markup. Each row must provide a cell for every
column and must not provide cells for unknown columns. A cell is either a `text`
or a `code` template, and code cells reuse the same code renderer as standalone
code questions.

```json
{
  "interaction": {
    "type": "typed_fill_blank",
    "content": {
      "type": "table",
      "columns": [
        { "id": "goal", "label": "Goal" },
        { "id": "api", "label": "PyTorch code" }
      ],
      "rows": [
        {
          "id": "clear-gradients",
          "cells": {
            "goal": { "type": "text", "template": "Clear accumulated gradients" },
            "api": {
              "type": "code",
              "language": "python",
              "template": "optimizer.{{zero}}()"
            }
          }
        },
        {
          "id": "backward",
          "cells": {
            "goal": { "type": "text", "template": "Backpropagate the loss" },
            "api": {
              "type": "code",
              "language": "python",
              "template": "loss.{{backward}}()"
            }
          }
        }
      ]
    },
    "slots": [
      { "id": "zero", "label": "Clear gradients", "placeholder": "method" },
      { "id": "backward", "label": "Backward method", "placeholder": "method" }
    ]
  },
  "canonical_answer": {
    "type": "typed_fill_blank",
    "answers": {
      "zero": { "accepted_answers": ["zero_grad"] },
      "backward": { "accepted_answers": ["backward"] }
    }
  }
}
```

`placeholder` is optional; when omitted the UI falls back to a generic hint. The
order blanks are displayed follows their position in the content (template
order, then table row/column order), not the order of the `slots` array.

### Syntax highlighting

Code is highlighted client-side with a locally bundled
[Prism](https://prismjs.com/) instance. Only the supported languages are
registered: `python`, `rust`, `bash`, `json`, `yaml`, `javascript`,
`typescript`, and `sql`. Aliases such as `py`, `sh`, `yml`, `js`, and `ts` are
normalized. An unknown language still renders as monospace code with working
blanks, just without colors.

Highlighting is display-only. Authored code is never executed or evaluated, and
is never injected as raw HTML. There is no server round trip, no external
service, and no LLM call to render a question.

### Normalization and matching

Answers are authored and matched deterministically, never by an LLM:

- Trim leading/trailing whitespace.
- Lowercase with Unicode-aware case folding.
- Collapse repeated internal whitespace.
- Ignore harmless trailing punctuation (`.`, `,`, `;`, `:`, `!`, `?`).

A blank is correct only when the normalized typed answer equals a normalized
accepted answer. There is no edit-distance or semantic matching, so textually
similar but technically different answers stay distinct: `SQS` does **not**
match `SNS`, and `ALB` does **not** match `NLB`. Aliases such as `Amazon SQS`,
`SQS`, and `Amazon Simple Queue Service` must be authored explicitly in
`accepted_answers`; they are never inferred.

### Validation

A bundle is rejected when:

- a `{{slot}}` placeholder has no matching slot definition;
- a declared slot is never referenced in any template (or is referenced twice);
- a placeholder is malformed, for example an unclosed `{{` or an id containing
  whitespace or braces;
- slot ids are duplicated;
- a `text` or `code` template is empty;
- a `code` template has a blank `language`;
- a table has no columns or no rows;
- a table column or row id is empty or duplicated;
- a row is missing a cell for a declared column, or has a cell for an unknown
  column;
- the canonical answer is missing a slot, or references an unknown slot;
- `accepted_answers` is empty, or an alias is empty or whitespace-only;
- the interaction and canonical-answer types do not match;
- `interaction_type` and `interaction.type` do not match.

Hints come from the shared `hints` list and never reveal an accepted answer.



## Certification planning

Inputs:

- exam date
- available minutes/day
- diagnostic result
- objective weights
- concept graph

Planner produces:

```text
foundation
-> gap closure
-> mixed application
-> boss/scenario practice
-> weak-area stabilization
-> final simulated exams
```

Replan after evidence changes.

## Readiness

Do not display a single unsupported "90% chance to pass."

Display:

- objective coverage
- calibrated recall/application estimates
- practice exam performance
- uncertainty
- remaining high-risk concepts

If a pass-probability model is later built, validate it against real exam outcomes before surfacing it.

## Freshness operations

Track per exam version:

```text
vendor
official blueprint URL
effective date
last checked
next review date
content version
deprecated concepts
```

Run a manual/automated diff when a vendor changes its official blueprint. Never silently remap historical mastery to a new exam version.

A content revision also invalidates in-flight missions: question ids may be
renamed or removed and the content version is bumped, so a persisted mission can
reference questions that no longer exist. That is recoverable, never a server
error:

- an answer for a stale mission returns `409` with code `mission_content_stale`;
- `/v1/sync` rejects only the stale event (its `error_code` is
  `mission_content_stale`) and keeps the rest of the batch;
- starting a Daily Mission item replaces a stale mission with one built from
  current content instead of resuming the unscoreable one.

The client drops the stale mission and its queued events, then starts a new
mission. Historical mastery is never remapped onto the changed content.

## Trademark and licensing

Before launch:

- review vendor trademark/logo rules
- do not imply AWS/Microsoft/Google/Linux Foundation endorsement
- retain source/license metadata for authored content
- do not use leaked exam dumps or copied proprietary item banks
