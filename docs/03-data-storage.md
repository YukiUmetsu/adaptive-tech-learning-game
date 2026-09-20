# Data and Storage Architecture

## Storage split

Use storage by access pattern.

| Data | Store | Why |
|---|---|---|
| users, goals | Postgres | transactional relational state |
| current learner snapshot | Postgres | frequent per-user reads |
| wallet/inventory | Postgres | strong consistency |
| gacha ledger | Postgres | auditability/idempotency |
| campaign progress | Postgres | relational state |
| mission/acceptance records | Postgres | authoritative learning/economy evidence |
| raw client telemetry | R2 | append-heavy, cheap storage |
| compacted Parquet/Iceberg | R2 | training/analytics |
| models | R2 | immutable artifacts |
| certification bundles | R2/static CDN (target); embedded in the API build today | cacheable/versioned |
| game media (art, audio, video) | R2 `app-assets` + CDN | cheap delivery; too large for the web bundle |
| local session cache | IndexedDB | offline/local-first |

> Current implementation note: certification and learning content is discovered
> under `content/` and embedded into the API binary at build time
> (`crates/content/build.rs`), then validated when the registry loads. Content is
> never fetched per request. Moving versioned bundles to R2/static CDN remains
> the target for content that should not ship in the API image.

## PostgreSQL schema

Minimum entities:

```text
users
certification_catalog
certification_versions
objectives
concepts
concept_edges
questions
question_concepts
user_goals
mission_instances
accepted_answers
user_concept_state
campaign_state
sync_batches
devices
device_wallets
bit_transactions
user_wallets
wallets
wallet_ledger
inventory
gacha_rolls
model_versions
recommendation_log
recommendation_events
study_session_log
daily_missions
daily_mission_items
discovery_progress
user_study_days
prediction_snapshots
prediction_outcomes
deletion_tombstones
```

## Learner snapshot

`user_concept_state` is a derived/cache representation, not ground truth.
Accepted `learning_events` remain authoritative, so the cache can be rebuilt
from them at any time.

One row exists per `(user, certification version, concept, assessment mode)`, so
recognition, recall, application, and structural reconstruction stay separate
evidence signals instead of being averaged into one number.

```text
user_id
certification_version
concept_id
assessment_mode
estimate               # bounded [0, 1]
evidence_mass          # accumulated weighted evidence; more mass decays slower
exposure_count
success_count
failure_count
last_practiced_at
last_success_at
model_version          # "heuristic-v1"
state_version          # monotonic per-row revision
updated_at
```

Do not accept blind client replacement of this row. Forgetting/retrievability is
computed on read at selection time from `evidence_mass` and
`last_practiced_at`; stored state is never aged by a background job.

## Discovery progress

`discovery_progress` stores server-persisted Knowledge Map discovery for
`(user_id, track_version, domain_id)`: the learning `content_version`, raw
`revealed_prompt_ids`, namespaced `revealed_element_ids`, and `updated_at`.

Discovery is **not** learning evidence. It never creates a `learning_event`,
concept state, a quiz score, or Bits. Node/module/domain state (explored,
unlocked, completed) is derived on read with the same rules the Knowledge Map and
planner share, so this table never becomes a second source of truth.

Merging is a monotonic set-union: the stored prompt/element sets are unioned with
each incoming batch. An older device can never remove a newer reveal, duplicate
batches are idempotent, and concurrent multi-device writes are serialized per
`(user, track, domain)` with a row lock, so there is no last-write-wins conflict.
Only domains the server's content registry knows about are persisted; unknown or
blank domains are dropped, so a client cannot accumulate arbitrary
`(track, domain)` rows in hot Postgres. The frontend is local-first: it renders
from `localStorage` immediately, merges the persisted response asynchronously,
and keeps working if persistence fails.

## Account-wide study days

`user_study_days` stores one row per qualified `(user_id, local_day)`, unique.
A day qualifies when at least one scored learning event is newly accepted; the
streak is derived from these unique days rather than a mutable counter, so
retries are idempotent. `local_day` uses the learner's persisted IANA timezone
(`users.timezone`), the same boundary Daily Missions use, so a timezone change
cannot farm extra days.

The streak is motivational, not learning evidence: it never touches
`learning_events`, `user_concept_state`, wallets, or rewards, and recording it is
best-effort and isolated from the authoritative answer transaction.

## Auxiliary recommendation history

`recommendation_log` records which optional recommendations were generated for a
learner, keyed by a stable `recommendation_id`. `recommendation_events` records
lifecycle stages (`shown`, `clicked`, `started`, `node_opened`, `completed`)
against that id, each with a stable `event_id` so a retried batch cannot insert
the same event twice. `mission_instances.recommendation_id` links a mission back
to the recommendation that started it.

Lifecycle telemetry is queued locally and delivered in batches, piggybacked on
`/v1/sync` as `auxiliary_events`, rather than one request per event.

These tables are deliberately **not** learning evidence: they never feed scoring,
rewards, concept state, or mastery. Writes are best-effort and never share a
transaction with authoritative learning-event persistence — a missing table, an
unreachable database, or a constraint failure must never fail a recommendation,
a mission, or a learning session.

Generation is recorded when the recommendation is computed. A recommendation
request is not proof the learner saw anything: `shown` is a separate client
event, and concept state is never updated because a recommendation was shown,
clicked, started, or completed. Only accepted, scored learning events change
knowledge state.

`study_session_log` is the matching auxiliary log for generated adaptive study
sessions. It stores the requested length and preference plus the produced
estimate; it is never learning evidence and writes are best-effort.

## Daily Missions

`daily_missions` is the immutable daily snapshot: `(user_id, track_id, day_key)`
is unique, `plan_type` is `adaptive` or `standard`, and `status` moves from
`active` to `completed`. `daily_mission_items` stores the ordered plan (kind,
domain, node, title, estimate, server-selected practice context) plus per-item
status. `mission_instances.daily_mission_id` / `daily_item_position` link a
scored mission back to the item it executes.

The day boundary is the learner's **persisted IANA timezone** (`users.timezone`),
captured once on the first Daily Mission request. The local `day_key` is derived
from that timezone, so a mission stays stable for the learner's local day and a
later browser-timezone change cannot move the boundary or mint additional
reward-bearing missions. A new mission is only created for a `day_key` strictly
later than the most recent one. The plan is generated once and never recomputed.

Daily Mission completion is not learning evidence. The completion bonus is a
single idempotent ledger event (`daily_mission_complete`, `event_id` =
mission id), so retries and concurrent requests can never award it twice.

## Prediction measurement (analytics only)

`prediction_snapshots` captures the `heuristic-v1` prediction **before** a
question is answered: per-concept estimate, evidence mass, retrievability,
uncertainty, and forgetting risk, plus the authored `ConceptWeight` mappings,
assessment mode, difficulty, model version, practice source, and whether the
item was spaced delayed retrieval. Snapshots are immutable; the answer never
modifies them.

`prediction_outcomes` links an accepted event to its prediction, append-only and
idempotent per `(prediction_id, event_id)`. Retry attempts remain as operational
data, but evaluation reads only the **first accepted attempt** for a question, so
retries cannot inflate predictive samples. `learning_events` remain authoritative
for actual outcomes; unresolved snapshots (abandoned questions) simply have no
outcome and are excluded from evaluation. Prediction and outcome rows never feed
scoring, rewards, or concept state, and every write is best-effort: measurement
can never block mission issuance, answer acceptance, reward settlement, or
concept-state updates. The aggregate calibration endpoint
(`/internal/model-evaluation`) is disabled outside local/test by default and,
when enabled there, requires an explicit `X-Internal-Token`; a normal learner
token is never sufficient.

Ownership is user-based: `mission_instances`, `learning_events`, and wallet
state carry an owning `user_id`. `device_wallets` is the legacy pre-auth table
and is retained only for audit; new settlements go to `user_wallets`. Rows
written before authentication existed have a NULL `user_id` and are excluded
from every user-scoped query rather than being attributed to a guessed account,
because a bare `device_id` is not a secure account-claim credential.

## Raw event schema

Preserve rich evidence:

```json
{
  "event_id": "uuid",
  "device_id": "uuid",
  "device_sequence": 812,
  "mission_instance_id": "uuid",
  "user_id": "uuid",
  "question_id": "q_123",
  "concept_ids": ["attention.query", "attention.key"],
  "difficulty_prior": 0.6,
  "assessment_mode": "relationship_recall",
  "interaction_type": "node_connection",
  "answer_payload": {"edges": [["q", "k"]]},
  "response_ms": 8400,
  "attempt": 2,
  "hints": 0,
  "occurred_at": "..."
}
```

The authoritative score/reward is produced server-side and stored in `accepted_answers`.

## Raw telemetry trust

An object in R2 is not automatically valid training data.

Training data is built from:

```text
accepted mission/answer records
+
R2 telemetry referenced by those records
+
abuse/data-quality filters
```

## R2 layout

```text
app-assets/
  v000001/                     # immutable asset-set version
    manifest.json              # logical id -> key, checksum, metadata
    art/companion/<id>.webp
    art/buildings/<id>.webp
    audio/sfx/<id>.ogg
    audio/music/<id>.ogg
    ui/icons/<id>.webp

raw-events/
  year=2026/month=09/day=18/<batch>.jsonl.gz

compacted/
  year=2026/month=09/day=18/part-*.parquet

models/
  memory/v000023/model.json
  memory/v000023/manifest.json

content/
  aws/dop-c02/v005/bundle.json
```

Game media is staged locally under `assets/` (gitignored; see
`assets/README.md`) and synced to the `app-assets` bucket. Bump the asset-set
version instead of overwriting published objects, serve them from an R2 public
domain behind Cloudflare with immutable caching, and never proxy media bytes
through Cloud Run. Small app-shell assets (icon, favicon) stay in the web bundle
and are served as static assets.

## Compaction

Millions of tiny session objects become an operations and analytics problem.

Pipeline:

```mermaid
flowchart LR
    Raw[Session JSONL.gz] --> Compact[Hourly/daily compaction]
    Compact --> Parquet[Partitioned Parquet]
    Parquet --> Train[DuckDB/Polars/ML]
    Compact --> Delete[Delete raw objects after retention window]
```

Keep raw objects long enough for recovery/audit, then delete after successful compaction.

## Analytics

Initial:

```text
R2 Parquet
-> DuckDB / Polars
-> Python notebooks/training
```

If remote SQL becomes useful, migrate selected datasets to **Apache Iceberg tables in R2 Data Catalog**, then query with R2 SQL.

Do not describe R2 SQL as querying arbitrary loose Parquet files.

## Deletion and privacy

Shared Parquet partitions make immediate physical deletion expensive.

Use two stages.

### Immediate logical deletion

- delete/disable live account state in Postgres
- add `deletion_tombstone(user_id, requested_at, version)`
- all dataset builders exclude tombstoned users immediately
- record tombstone-filter version in each training snapshot

### Background physical deletion

- find affected raw/compacted partitions
- rewrite partitions without deleted users
- delete superseded objects
- record completion

Do not create one object per user solely for deletion convenience.

## Trained-model deletion policy

Document whether deletion requires retraining previously trained shared models. This is a policy/legal decision; do not imply automatic removal from an already-trained model unless implemented.

## Retention

Suggested defaults:

- live account/learner state: while account exists
- wallet/gacha ledger: according to legal/accounting needs
- raw telemetry: bounded retention before compaction
- compacted learning history: long-lived if privacy policy permits
- diagnostic logs: short retention
- model artifacts: production + rollback + selected reproducibility checkpoints
