# Implementation Plan

Build trustworthy learning evidence before the economy.

## Phase 0 — Repository and infrastructure

Deliver:

- Rust/Axum API skeleton
- React/Vite/PWA frontend
- local Postgres + SQLx migrations
- WorkOS staging auth
- Cloud Run / Neon / R2 dev environments
- OpenAPI -> generated TypeScript client
- baseline IaC for reproducible environments

Exit: authenticated user can load and sync a trivial state.

> Phase 0 implementation note: this repository currently implements the local
> foundation only — Rust/Axum skeleton, React/Vite/PWA shell, local PostgreSQL
> with SQLx migrations, and OpenAPI → TypeScript generation. WorkOS staging
> auth, deployed Cloud Run/Neon/R2 environments, and IaC are deliberately
> deferred until credentials and environments exist. See
> [Local development](11-local-development.md).

## Phase 1 — Narrow learning MVP

Use **one deliberately narrow slice** of one certification, not full exam coverage.

Deliver:

- certification/version/objective/concept schema
- 100-300 validated interactions for that slice
- connection, ordering, classification, equation mechanics
- keyboard/tap alternatives and reduced-motion support
- immediate feedback
- canonical server scoring format
- event IDs/device IDs
- current concept-state cache

Exit: useful study sessions work without game mechanics and events are deterministic/replayable.

> Phase 1 implementation note: the repository currently implements one narrow
> slice — AWS SOA-C03, Domain 1, Task 1.1 — with classification, ordering, and
> node-connection interactions, server-side scoring, a normalized learning
> event, local-first persistence, and a batched sync endpoint. This is
> deliberately smaller than the 100-300 interaction target below: the current
> bundle has a small validated set for one task, and the equation mechanic is
> not implemented yet. Domains 2-5 and other tasks are blueprint metadata only.
> Adaptive scheduling, mastery prediction, and gamification remain out of scope.

## Phase 2 — Authoritative mission + sync protocol

Deliver:

- versioned `mission_instance`
- frozen reward-policy/knowledge snapshot
- answer primitives sent to server
- server rescoring
- multi-device deduplication
- offline pending rewards
- conflict rules by state type

Exit: replaying/rebatching cannot duplicate rewards or overwrite newer state.

## Phase 3 — Learning measurement

Deliver:

- diagnostic
- HLR baseline
- FSRS baseline
- DAS3H-style candidate
- calibration dashboard
- temporal/new-user/new-item/new-concept evaluations

Exit: recall predictions are measured, calibrated, and reproducible.

## Phase 4 — Adaptive planning

Deliver:

- exam date + available-time goal
- objective weighting
- daily mission recommendation
- "why this plan?"
- alternatives/override
- separate teaching-policy evaluation

Exit: scheduler selects plausible sessions and is evaluated separately from the predictor.

## Phase 5 — Economy

Deliver:

- append-only wallet ledger
- Credits + Energy
- first-attempt/recovery reward invariant
- anti-farming multiplier frozen pre-attempt
- authoritative settlement

Exit: intentional failure is never the optimal reward strategy.

## Phase 6 — Game world

Deliver:

- small persistent world
- buildings/exploration
- anime companion
- cosmetics/inventory

Exit: earned resources have useful visible uses.

## Phase 7 — Earned gacha

Deliver:

- daily/weekly earned mystery rewards
- published odds
- pity
- duplicate conversion
- audit ledger

Exit: no real-money randomized rewards; settlement is server-authoritative.

## Phase 8 — Boss battles

Examples:

- cloud architecture repair
- Kubernetes troubleshooting
- ML pipeline construction
- Linux/system diagnosis

Boss interactions must emit structured concept/error evidence.

## Phase 9 — Retention + learning experiments

Test:

- mission length
- reward frequency
- companion feedback
- progress visualization
- gacha cadence

Guardrails:

- delayed recall
- learning gain/minute
- review burden
- farming/abuse

## Phase 10 — Second certification

Add only when:

- content authoring/validation is usable
- concept reuse works
- first campaign has real retention data
- freshness/versioning process is operational

## Content coverage matrix

Track:

```text
exam objective
concept
assessment modes
independent item count
boss integration
source references
last vendor-blueprint review
```

## Repository

```text
/apps
  /api
  /web

/crates
  /domain
  /db
  /economy
  /planner
  /sync

/ml
/content
/infra
/docs
```

Do not create microservices initially.
