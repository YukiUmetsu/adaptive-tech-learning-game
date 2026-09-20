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

> Phase 0 implementation note: the repository implements the local foundation —
> Rust/Axum skeleton, React/Vite/PWA shell, local PostgreSQL with SQLx
> migrations, and OpenAPI → TypeScript generation — and WorkOS AuthKit is wired
> end to end (API token verification plus the web sign-in flow). The web app is
> hosted on Cloudflare (Worker static assets, see `apps/web/wrangler.jsonc`).
> The Cloud Run API, Neon database, R2 storage, and IaC are deferred until those
> environments exist. See [Local development](11-local-development.md) and
> [Deployment](12-deployment.md).

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

> Phase 1 implementation note: the MVP now spans more than the original narrow
> slice. All five AWS SOA-C03 domains are authored, joined by AWS SAA-C03,
> AWS AIP-C01, HashiCorp Terraform Associate 004, and AI/Python tracks
> (Python fluency, Python data stack, PyTorch core), with original demo bundles
> for every interaction type. The web app has a certification catalog, a
> certification dashboard, three quiz modes with server-side selection, a
> pre-quiz Knowledge Map (progressive `table`/`code_file` reveals), a
> server-authoritative Bits currency, and a full set of tactile interaction
> types.
>
> Adaptive selection now reads a persistent derived `user_concept_state` cache
> (the deterministic, bounded `heuristic-v1` model) keyed per assessment mode.
> Accepted events preserve the canonical question `difficulty_prior`, and
> selection combines concept state, forgetting risk, domain weight, uncertainty,
> difficulty fit, novelty, and repeat penalty with a deterministic tie-break.
> It remains a heuristic, not mastery: trained student models (HLR/FSRS/DAS3H),
> calibration, and the persistent game world remain out of scope.

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

> Phase 4 implementation note: an optional, deterministic planner V1 ships early
> as a pure `PlannerInput -> Recommendation` function (`apps/api/src/planner.rs`)
> exposed at `POST /v1/tracks/{track_id}/recommendation`. It recommends
> `learn_node`, `review_node`, `practice_question`, or `practice_domain` with a
> stable reason code, using concept state, difficulties, prerequisites, and
> optional client discovery progress. Discovery is derived server-side with the
> exact Knowledge Map rules, so a module prerequisite is satisfied only when the
> module is complete. It is track-agnostic and works for non-certification
> Learning Tracks.
>
> Recommendations now execute: `learn_node`/`review_node` open the exact node,
> `practice_question` starts a server-built `recommended_practice` mission that
> guarantees the anchor question, and `practice_domain` starts a domain quiz.
> A recommendation carries a stable `recommendation_id`, and lifecycle stages
> (`shown`, `clicked`, `started`, `node_opened`, `completed`) are recorded as
> auxiliary telemetry. A recommendation request is not treated as "shown", and
> telemetry is never learning evidence.
>
> A short session planner now composes several of these actions into one
> deterministic study session (`apps/api/src/planner/session.rs`), exposed at
> `POST /v1/tracks/{track_id}/session` with `available_minutes` and a preference
> (`balanced`, `more_practice`, `more_learning`). Sessions order learning and
> prerequisite activities before retrieval practice, keep practice questions
> server-selected, and stay near the requested time. The frontend shows an
> optional "Your study session" section with small overrides (shorter, more
> practice, more learning, regenerate) and, if adaptive planning fails for any
> reason, falls back to a standard non-adaptive session built from already-loaded
> track content. Session logging is auxiliary.
>
> It remains a heuristic: exam-date goals, availability constraints, the full
> "why this plan?" surface, and separate teaching-policy evaluation are still to
> come. Recommendation, session, and telemetry failures never block the
> dashboard, knowledge maps, quizzes, missions, or sync.

## Phase 5 — Economy

Deliver:

- append-only wallet ledger
- Bits + Energy
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
