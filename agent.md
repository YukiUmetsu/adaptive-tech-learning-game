# Project Agent Instructions

## Purpose

Build an adaptive technical-certification learning game for cloud, AI, Linux, security, math, and IT knowledge.

The product:
- predicts what a learner is likely to forget,
- chooses the next useful study mission,
- explains why it chose that mission,
- supports learner overrides,
- uses tactile retrieval puzzles,
- turns useful study into visible game progress.

Keep implementation decisions aligned with the repository documentation under `docs/`.

## Source of truth

Before making architecture, storage, auth, ML, economy, or deployment changes, read the relevant document under `docs/`.

Priority:
1. current user/task request
2. `AGENTS.md`
3. relevant `docs/*.md`
4. existing code/tests
5. reasonable implementation judgment

If code and docs disagree, do not silently choose one. Identify the mismatch and make the smallest change that preserves the intended architecture.

## Core architecture

Default stack:
- Web/PWA: React + TypeScript + Vite
- API: Rust + Axum + Tokio
- Database: PostgreSQL via SQLx
- API hosting: Google Cloud Run
- PostgreSQL hosting: Neon
- Object/event/model storage: Cloudflare R2
- Authentication: WorkOS AuthKit
- ML training: Python locally first; Modal/RunPod only when needed
- Analytics: Parquet + DuckDB/Polars first

Do not replace these choices without an explicit requirement or measured reason.

## Architecture invariants

### Keep the system simple
- One Rust API service initially.
- No microservices without a demonstrated scaling/security boundary.
- No Kubernetes for the initial product.
- No Redis/cache/queue until metrics show a need.
- No WASM requirement for the learning engine.
- Prefer portable standards: OCI containers, PostgreSQL, HTTP, S3-compatible object storage.

### Local-first learning
Ordinary study interaction should run locally:
- drag/drop
- arrow/node interaction
- animations
- puzzle flow
- local session scheduling
- temporary local state

Target roughly 2-5 backend requests per study session.

Do not create a per-drag or per-question network dependency unless correctness requires it.

### Server-authoritative economic state
The server is authoritative for:
- wallet balances
- currency
- inventory ownership
- gacha results
- purchases/entitlements
- accepted mission completion
- reward settlement

Never trust client-supplied:
- final balance
- final reward
- gacha result
- mastery change as authoritative evidence

### Mission and reward protocol
A mission should be issued with a stable/versioned identity such as:
- `mission_instance_id`
- `user_id`
- content/question version
- reward-policy version
- knowledge-snapshot/model version
- issue/expiry time
- nonce/idempotency data

The client sends answer primitives and structured interaction evidence.
The server re-scores responses against canonical content before settling rewards.

Offline rewards remain pending until reconciliation.

Reward invariant:

```text
first-attempt success
>= failure + unaided recovery
> failure + reveal/skip
```

Never make intentional failure economically optimal.

Freeze challenge/reward difficulty from the pre-attempt state.

### Sync and multi-device rules
Every learning event should have a stable unique event ID.
Track enough information to deduplicate and order device activity:
- `event_id`
- `device_id`
- device/session sequence where useful
- `mission_instance_id`
- `occurred_at`

Learning history is append-oriented.
Derived concept state is a cache/snapshot, not blindly last-write-wins.

Economy mutations use:
- server ledger
- transaction
- idempotency key
- optimistic versioning where applicable

Do not allow two offline devices to independently spend the same authoritative balance.

## Backend rules

### Rust
Prefer idiomatic, readable Rust over clever abstractions.

Use:
- Axum
- Tokio
- SQLx
- Serde
- `tracing`
- typed errors

Guidelines:
- keep domain/business rules out of HTTP handlers,
- handlers validate/authorize and call domain/application services,
- use explicit data types instead of unstructured maps,
- avoid `unwrap()`/`expect()` in production request paths,
- never log secrets/tokens,
- avoid unnecessary cloning when clear ownership solves it,
- optimize only after measurement.

### SQL/PostgreSQL
- Write explicit SQL through SQLx.
- Use parameterized queries.
- Use migrations for schema changes.
- Use transactions for wallet, gacha, entitlement, and mission settlement.
- Keep connection pools intentionally small because Cloud Run can scale horizontally.
- Avoid N+1 query patterns.
- Add indexes from query patterns, not speculation.
- Do not store unlimited raw quiz history in hot PostgreSQL tables.

### API contracts
Prefer Rust structs as the source of API schema.
Generate OpenAPI and TypeScript client/types rather than duplicating contracts manually.

Keep endpoints coarse-grained and batch-friendly.

## Data/storage rules

### PostgreSQL
Use for live transactional state:
- users
- goals
- certification versions
- concepts/relationships
- current learner state
- campaigns
- accepted mission results
- wallet ledger
- inventory
- gacha ledger
- entitlements
- sync metadata

### R2
Use for:
- raw/batched learning telemetry
- training datasets
- Parquet/Iceberg files
- immutable model artifacts
- large/versioned content bundles
- game/media assets where appropriate

Do not create an R2 object for every tiny UI event.

Batch first; compact later.

For high-volume raw telemetry, prefer short-lived presigned client uploads so Cloud Run does not proxy large bodies. Treat client-uploaded telemetry as untrusted until referenced by accepted server records.

### Deletion
Do not claim user deletion is complete merely because PostgreSQL rows were deleted.

Support:
- deletion/tombstone records,
- immediate exclusion from future ML datasets,
- background rewrite/compaction of shared historical partitions,
- deletion of superseded objects,
- auditable completion state.

## Authentication and authorization

Use WorkOS AuthKit.
Initial login:
- Google OAuth
- passwordless Magic Auth/email code

Do not implement passwords in V1 unless requested.

Backend must independently enforce authorization after authentication:
- ownership
- entitlement
- admin access
- economic actions

Do not use email as a primary key.

Secrets:
- never expose WorkOS API secrets to frontend,
- never commit credentials,
- never log access/refresh tokens.

## Frontend and UX

### Learning interactions
Primary mechanics:
- connect nodes with stretched arrows
- order blocks
- memory reconstruction
- assemble equations
- drag into categories/tables
- 2D matrix sorting
- troubleshooting
- integrated boss battles

Feedback:
- immediate,
- short,
- visually satisfying,
- one small explanation,
- no unnecessary modal interruption.

### Accessibility
Every drag/connect interaction needs a non-drag equivalent.

Support:
- keyboard navigation
- tap/select then place/connect
- reduced motion
- no color-only status
- large touch targets
- screen-reader labels where practical
- timer-off/relaxed mode

Do not assume browser haptics are available, especially on iOS.

## Learning model

The system predicts probability; UI labels are derived views.

Primary target:

```text
P(success | learner, concept, assessment mode, item, time, history)
```

Keep recognition separate from recall.

Initial evidence modes:
- recognition
- recall
- application
- structural reconstruction

Treat these as measurement/evidence modes until data demonstrates distinct latent mastery dimensions.

### Model progression
Benchmark simple models first:
1. HLR
2. FSRS baseline where applicable
3. DAS3H-style multi-skill/time-aware model
4. deep KT only if real data shows material improvement

Possible later research:
- AKT
- LefoKT
- content-aware KT

Do not choose a neural model because it is newer.

### Evaluation
Separate:
1. student-model quality
2. teaching/scheduling policy quality

Student-model metrics:
- Brier score
- log loss
- calibration/reliability
- ECE
- AUC as secondary

Evaluation slices:
- within-user temporal holdout
- new-user holdout
- new-item holdout
- new-concept holdout
- certification/domain holdout
- assessment-mode slices

Teaching policy must ultimately be evaluated by:
- delayed recall
- learning gain per minute
- useful study time
- review burden
- objective coverage
- learner return/retention

A better predictor does not automatically imply a better scheduler.

### ML deployment
Train locally first.
A candidate model is never promoted only because it is newer.

Promotion requires:
- reproducible training run,
- schema compatibility,
- better or meaningfully equivalent metrics,
- no serious subgroup regression,
- rollback artifact.

Model artifacts are immutable and versioned.

## Gamification

Core resources:
- Credits: spendable
- Energy: game-world actions only
- mastery/XP: non-spendable progress

Energy must never block studying.

Reward useful retrieval, not raw question count.

Anti-farming:
- diminishing reward for trivial repetition,
- frozen pre-attempt challenge estimate,
- repeated-attempt caps,
- server settlement,
- anomaly checks.

### Gacha
Initial gacha is earned-only.
Requirements:
- published odds
- pity system
- duplicate conversion
- no item required to learn
- no cash-purchased randomized rewards without explicit legal/app-store review

## Certification content

Certification content is versioned by exam blueprint.

Track:
- vendor
- certification
- exam/version
- effective date
- official blueprint source
- objective weights
- concepts
- prerequisites
- content version
- last reviewed date

Do not use leaked exam dumps or copied proprietary question banks.

Keep vendor endorsement/trademark language accurate.

## Cost discipline

Cost is a first-class constraint.

Prefer:
- static/CDN delivery
- batch sync
- scale-to-zero compute
- cheap object storage
- local ML training
- client caching
- short log retention
- no per-question LLM calls

Do not optimize framework microbenchmarks before:
- DB query count,
- DB duty cycle,
- network transfer,
- object-operation count,
- model/LLM/GPU usage,
- observability cost.

When adding infrastructure, explain:
1. the measured problem,
2. why current design cannot solve it simply,
3. recurring cost impact,
4. migration/rollback plan.

## Repository expectations

Expected structure:

```text
/apps
  /api
  /web

/crates
  /domain
  /db
  /economy
  /planner

/ml
/content
/infra
/docs
```

Do not create directories/modules solely to match this sketch if the repository evolves differently.

## Work style for coding agents

Before changing code:
1. inspect the relevant implementation,
2. read the relevant `docs/*.md`,
3. identify invariants/tests affected,
4. make the smallest coherent change.

Do not:
- rewrite unrelated files,
- perform opportunistic refactors unless required,
- change providers/frameworks silently,
- invent APIs/packages without checking installed versions or documentation,
- hide failing tests,
- weaken validation to make tests pass.

When a task is ambiguous but a safe minimal implementation exists, make the minimal choice and state the assumption.

## Verification

After Rust changes, run the relevant subset, then full checks when practical:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

After web changes, inspect `package.json` first and run the repository's actual scripts for:
- lint
- typecheck
- tests
- build

After ML changes:

```bash
uv run pytest
```

Do not invent script names if they do not exist.

For DB changes:
- run migration against local test DB,
- test rollback/forward migration strategy where applicable,
- test transactional invariants.

For economy changes, explicitly test:
- idempotent retry,
- duplicate event,
- concurrent requests,
- insufficient balance,
- deliberate-failure exploit,
- offline reconciliation.

## Completion standard

A task is complete only when:
- code follows architecture invariants,
- relevant tests pass,
- new behavior has tests,
- error paths are handled,
- docs are updated if a public contract/architecture changed,
- no new unnecessary cloud dependency was introduced,
- cost/security implications were considered.
