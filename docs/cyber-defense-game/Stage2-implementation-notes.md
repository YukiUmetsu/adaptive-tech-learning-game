# Cyber Defense Stage 2 — Implementation Notes

Companion to `Stage2.md`. Records what was built, the decisions taken, how it was
verified, and what remains.

## Status

All 20 steps were implemented to a working, tested degree. The full Stage 2 loop
is in place: campaign → repeatable server-issued Operations → permanent career,
hero, Tower, adversary, dossier, and story progression, all server-authoritative.

### Server-authoritative systems

- Career XP and level (`crates/domain/src/cyber_defense.rs`).
- Bits rewards for the five campaign missions and repeatable Operations, settled
  through the existing wallet ledger.
- Persistent Tower/HQ upgrades with prerequisites and canonical costs.
- Persistent hero XP and talent selections with validation and free respec.
- Deterministic Operation generation (`crates/domain/src/cyber_operation.rs`),
  including a 1,000-run invariant test.
- Threat Level bounds, unlock rule, and recommended-Threat-Level rule.
- Recurring adversaries, rank, and adversary progress.
- Dossier flags and story triggers (`crates/domain/src/cyber_story.rs`).
- Legacy local-progress import (untrusted, no retroactive Bits/XP).
- Batched balance telemetry.

### API endpoints added

| Method | Path |
|---|---|
| GET | `/v1/cyber-defense/profile` |
| POST | `/v1/cyber-defense/campaign/{mission_id}/complete` |
| POST | `/v1/cyber-defense/tower/upgrades/{upgrade_id}` |
| PUT | `/v1/cyber-defense/heroes/{hero_id}/talents` |
| POST | `/v1/cyber-defense/operations` |
| GET | `/v1/cyber-defense/operations/{run_id}` |
| POST | `/v1/cyber-defense/operations/{run_id}/abandon` |
| POST | `/v1/cyber-defense/operations/{run_id}/complete` |
| POST | `/v1/cyber-defense/legacy-progress` |
| POST | `/v1/cyber-defense/telemetry` |

`POST /v1/cyber-defense/upgrades` (in-run upgrade spending) was removed in the
Stage 2.2 pass: no supported client called it, in-run upgrades use mission
credits only, and its frontend flush queue was dead code. See "Stage 2.2" below.

### Migrations

- `20261003000001_cyber_defense_stage2` — profiles, hero progress, Tower
  upgrades, adversary progress, story progress, campaign results, operation runs.
- `20261003000002_cyber_reward_events` — one-off reward idempotency.
- `20261003000003_cyber_operation_active_unique` — at most one active Operation
  per learner.
- `20261003000004_cyber_telemetry` — batched balance telemetry.
- `20261003000005_cyber_integrity_replayability` — Operation offers, cosmetic
  unlocks, and `equipped_theme`.
- `20261003000006_cyber_operation_deploy` — `deployed_at`, the authoritative
  pre-deploy → deployed boundary.

## Key decisions and assumptions

- **Operation generation lives in Rust.** The server owns template, adversary,
  modifier, map, attack, defense, and hero catalogs so it can validate invariants
  before issuing a run. The frontend has matching display data.
- **`stars == 0` means failure** for both campaign and Operations, matching the
  engine's `rateMission` (a survived mission always earns at least one star).
- **Campaign completion is client-reported** (the Stage 1 simulation still runs
  in the browser), but every reward value, first-clear decision, and level is
  derived server-side from canonical policy. `result_id` makes a retry
  idempotent.
- **Operation completion is guarded by run status**, so a duplicate completion
  settles nothing. The reward is recorded on the run (`reward_event_id`).
- **Recommended Threat Level** uses the last five settled Operations and never
  changes during a run. The player can always choose lower.
- **Unlocked Threat Level** is `max(recommended + 2, highest_cleared + 1)`,
  clamped to 1–10, so a new player cannot farm the top level.
- **Legacy import** stores completion/stars/health/attempts only. It grants a
  single fixed 50 career XP "returning defender" bonus when at least one valid
  mission was previously completed, and never grants Bits.
- **Telemetry** is buffered client-side and flushed as small batches; it stores
  only game identifiers and results.

## Verification

Run against local Postgres (`DATABASE_URL=postgres://app:app@127.0.0.1:55432/app`).

- `cargo fmt --check` — clean.
- `cargo clippy --all-targets --all-features -- -D warnings` — clean.
- `cargo test --no-fail-fast` — all Stage 2 suites pass. Two failures are
  **pre-existing and unrelated** (see below).
- `cd apps/web && pnpm typecheck` — pass.
- `cd apps/web && pnpm lint` — 0 errors (2 pre-existing warnings in
  `QuestionPrompt.tsx`).
- `cd apps/web && pnpm test` — 127 files, 1046 tests pass.
- `cd apps/web && pnpm build` — pass.

### Known pre-existing failures (not Stage 2 regressions)

Both were confirmed to fail identically on the clean `HEAD` baseline:

1. `apps/api/tests/daily_missions.rs::completing_every_item_awards_the_bonus_exactly_once`
   — the GET response is built from the pre-settlement mission snapshot, so
   `reward_granted` reads `false` even though settlement succeeded.
2. `crates/content/tests/family_guide.rs::tracks_without_guides_still_load`
   — embedded content now contains family guides, so the "no guides" assumption
   no longer holds.

## UI redesign (game-first hub)

After review, `/game`, `/game/tower`, and `/game/heroes` were rebuilt to match
the Stage 1 game's neon art instead of emoji and text blocks:

- `CyberDashboard` is now a command-center hub: identity + XP, resource chips
  (Bits, Tower, adversary, Operations), a live decorative `HubScene` (turrets,
  malware creatures, protected core), one prominent mission card, an
  icon-forward upgrade grid, and the campaign.
- Tower is a grid of room cards with turret art, level pips, a cost chip, and an
  Upgrade button; Heroes uses champion art, milestone pips, XP bars, and
  properly laid-out talent choices.
- Emoji were removed from these screens in favour of the existing SVG art
  (`TowerArt`, `HeroArt`, `CoreArt`, `EnemyArt`, `Icons`).
- Fixed a bug where the hub scene's CSS `transform` animation overrode each
  enemy's SVG position, collapsing them into a corner; the positioned `<g>` now
  wraps the animated `<g>`.

## Known limitations / deferred work

- **Tower in-run effects.** Rooms persist and are purchasable, and every room
  now changes actual gameplay (SOC and Threat Intelligence gate the briefing,
  the Training Center adds hero XP server-side, the Engineering Lab allows
  validated loadout substitutions, and the Resilience Center improves the
  postmortem and grants one emergency recovery). See the progression pass below.
- **Story presentation** is the archive page plus a "Story advanced." line in the
  settlement summary. There is no dedicated story card modal; skipped/unseen
  tracking is a local acknowledgement (`game/persistence/storyAck.ts`).
- **Operation template browsing** is replaced by server-issued offers: the
  dashboard fetches a stable set of up to three eligible Operations
  (`POST /v1/cyber-defense/operations/offers`) and starts exactly the one the
  player selects, or the story-gated confrontation. A client cannot forge an
  offer for locked content; the legacy random-selection path remains as an
  offline fallback.
- **Telemetry** is wired to dashboard views, Operation start/resume/complete/
  abandon, threat level, operator selection, defense placed/upgraded/removed,
  hero deployed, Tower purchase, talent selection, adversary rank up, dossier
  unlock, and story seen. High-frequency combat telemetry is deliberately absent.
- **E2E** covers Cyber Defense, the learning journey, questions (practice
  tests), and Settings; see the E2E section below.

## Progression-matters pass ("make existing Stage 2 progression actually matter")

This pass did not add towers, enemies, heroes, missions, currencies, or game
modes. It wired existing Stage 2 progression into real gameplay, preserved all
Stage 1 behaviour, and is covered by new unit/integration tests.

### What now affects gameplay

- **Hero talents** are resolved once at run start through the existing
  `resolveHeroRuntime` and frozen for the run, then handed to the simulation via
  the catalog (`data/heroRuntime.ts`, `hooks/useFrozenHeroTalents.ts`). The
  simulation was not changed: it already reads all hero stats from
  `catalog.heroesById`.
- **Operator choice**: the dashboard's `OperationSetup` sends `hero_id` and
  remembers the last operator locally; the server still validates it.
- **Threat Level choice**: the dashboard offers nearby levels plus an advanced
  selector, never above the server's `unlocked_threat_level`.
- **SOC / Threat Intelligence** gate the Operation briefing through one pure
  `deriveOperationIntelVisibility` function. Hidden waves, modifiers, boss
  presence, and adversary specialty are not rendered at all before their level.
- **Training Center** adds a server-derived hero-XP bonus; the client never
  submits a boosted value.
- **Engineering Lab** allows up to its level in defense substitutions on an
  active run (`PUT /v1/cyber-defense/operations/{run_id}/loadout`). The server
  derives the allowance, validates each swap, and re-checks every generation
  invariant, so a swap can never create an impossible run.
- **Resilience Center Lv1** adds breach-layer and suggested-counter detail to the
  postmortem; **Lv2** grants one emergency recovery per Operation.
- **Campaign unlocking** uses server campaign state first (`data/campaignUnlock.ts`),
  with local Stage 1 progress only as a pre-import fallback. One helper is shared
  by the dashboard and the mission page.
- **Server enforces the campaign → Operations lock** (`403 cyber_operations_locked`).
- **Adversaries are story-gated** (`available_adversaries`): GHOST-7 after
  Chapter 1, NULL after the early Chapter 2 milestone, VIPER after Chapter 3.
- **The Stage 2 climax requires a real battle**: `chapter-5-climax` now triggers
  on completing the `ghost7-confrontation` Operation, not on a rank number.
- **Durable pending settlement**: a lost connection keeps a local pending record
  and retries with the same identifiers (`state/pendingSettlements.ts`).
- **Telemetry**: the remaining allowlisted events are emitted (defense
  placed/upgraded/removed, hero selected/deployed, Tower purchase, talent
  selection, adversary rank up, dossier unlock, story seen).

### Balance constants introduced

- Training Center hero XP: Lv1 ×1.00, Lv2 ×1.10, Lv3 ×1.15
  (`training_center_hero_xp_multiplier`).
- Resilience Center: trigger at 25% max health, restore 10% max health, once per
  Operation (`RESILIENCE_TRIGGER_THRESHOLD` / `RESILIENCE_RESTORE_FRACTION`).
- SOC: Lv2 reveals wave 1, Lv3 reveals waves 1–2, Lv4 adds approximate intensity
  and exact counts.
- Threat Intelligence: Lv1 adversary specialty, Lv2 one modifier, Lv3 boss
  presence and the full modifier set.
- Engineering Lab: Lv1 one substitution, Lv2 two substitutions.
- Adversary unlocks: GHOST-7 (Chapter 1), NULL (`chapter-2-clue`), VIPER
  (`chapter-2-clue` + `chapter-3-null`).
- Confrontation: requires `chapter-4-biolab` and GHOST-7 rank ≥ 5; template id
  `ghost7-confrontation`, never chosen by the random picker.

### API / contract changes

- `GET /v1/cyber-defense/profile` now also returns `operations_unlocked`,
  `confrontation_available`, and `available_adversaries`.
- New endpoint `PUT /v1/cyber-defense/operations/{run_id}/loadout`.
- New error codes `cyber_operations_locked` and `cyber_operation_locked` (403).

### Tests added

- Domain: campaign-complete gate, Training Center multiplier, adversary unlock
  ordering, confrontation trigger, confrontation availability.
- API: campaign → Operations lock, GHOST-7 first Operation and locked-adversary
  rejection, confrontation gating and battle-resolved climax, unknown-hero
  rejection, Training Center hero-XP bonus, Engineering Lab swap validation.
- Frontend: hero runtime resolution + simulation cooldown integration + frozen
  talents, Tower intel visibility, briefing gating, cross-device campaign unlock,
  operator selection and fallback, pending settlement durability/retry,
  Engineering Lab loadout panel, resilience recovery simulation.

### Verification (this pass)

- `cargo fmt --check` — clean.
- `cargo clippy --all-targets --all-features -- -D warnings` — clean.
- `cargo test --no-fail-fast` with local Postgres — all Stage 2 suites pass; the
  two pre-existing failures below still fail.
- `cd apps/web && pnpm typecheck` — pass.
- `cd apps/web && pnpm lint` — 0 errors (2 pre-existing warnings).
- `cd apps/web && pnpm test` — 136 files, 1099 tests pass.
- `cd apps/web && pnpm build` — pass.
- `cd apps/web && E2E_DATABASE_URL=... pnpm exec playwright test` — 11 tests
  pass (Chromium): Cyber Defense (2), learning (6), questions/practice test (1),
  Settings (2).

### Intentionally deferred

- **Training Center Lv3**: free respec already exists globally, so instead of
  inventing a saved-loadout system it grants ×1.15 hero XP. A multi-loadout
  system is deferred rather than faked.
- **Operation template browsing** remains deferred; only explicit
  confrontation selection is new.

### E2E suite

Playwright coverage now spans the whole app, not only the learning journey. The
config forces `dev:` auth for E2E (empty `WORKOS_*` / `VITE_WORKOS_*`), so the
suite is hermetic and does not depend on a developer's local WorkOS `.env`.

- `e2e/cyber_defense.spec.ts` — the Stage 2 progression loop. Because the
  tower-defense battle is a real-time simulation, the spec seeds Chapter 1
  through the same public API the game uses, then drives the UI with a unique
  local developer identity per test. It covers: fresh campaign unlocks
  Operations; operator and Threat Level choice; the briefing hiding wave detail
  and adversary specialty at SOC/Threat-Intel Lv1; buying SOC Lv2 and reloading
  revealing the first wave; and a server-settled Operation persisting on the
  dashboard.
- `e2e/learning.spec.ts` — the learning/mission journey, including the question
  interactions. Its helper now discovers real content bundles (instead of
  assuming every `content/**/*.json` is a bundle), supports the current
  `typed_fill_blank` questions, and targets a node-connection task dynamically,
  so content updates no longer break it.
- `e2e/questions.spec.ts` — the exam-simulation practice test: start the exam,
  use the question navigator, mark for review, submit behind the confirmation,
  and read the scored review. The practice test is discovered through the public
  API rather than hardcoded.
- `e2e/settings.spec.ts` — Personal Settings: accessibility preferences persist
  across a reload and reset behind a confirmation; master volume at 0 disables
  the dependent audio controls.

Run the whole suite:

```bash
cd apps/web
E2E_DATABASE_URL=postgres://app:app@127.0.0.1:55432/app pnpm e2e
```

The config reuses servers already listening on 5173/8080 by default. If a normal
(non-dev-auth) dev server is running there, run E2E on isolated ports so it
starts its own dev-auth servers:

```bash
E2E_DATABASE_URL=postgres://app:app@127.0.0.1:55432/app \
E2E_API_PORT=8099 E2E_WEB_PORT=5199 pnpm e2e
```



---

# Stage 2.2 — Integrity + Replayability Pass

This pass made existing Cyber Defense systems more trustworthy, replayable, and
strategically interesting. It did **not** add another game mode, daily systems,
PvP, energy, gacha, or more heroes/attacks.

## What was implemented

### 1. Immutable, reproducible Operations (run snapshot)

Every Operation now stores a `progression_snapshot` inside its immutable
`generated_config`:

```jsonc
"progression_snapshot": {
  "hero": { "hero_id": "security_engineer", "level": 12, "selected_talents": { "5": "rapid_response" } },
  "tower": {
    "soc_level": 2,
    "threat_intelligence_level": 0,
    "training_center_level": 1,
    "engineering_lab_level": 1,
    "resilience_center_level": 0
  }
}
```

- `POST /v1/cyber-defense/operations` (and the offer path) build the snapshot
  once from the selected hero's progress/talents and the five Tower room levels,
  and persist it with the run.
- The **server** uses the snapshot at settlement (Training Center hero-XP
  multiplier) and at loadout time (Engineering Lab allowance).
- The **browser** resolves hero talents, SOC/Threat-Intel briefing visibility,
  Resilience recovery/postmortem, and swap allowance from the run snapshot, not
  the current profile. A respec or Tower upgrade after a run starts affects only
  future runs.
- Runs persisted before this pass (no snapshot field) still deserialize, thanks
  to `#[serde(default)]`; the frontend falls back to the profile for those.

### 2. Server-side campaign order

- Canonical order lives in `crates/domain/src/cyber_defense.rs`:
  `ddos-basics → sql-injection → credential-stuffing → mixed-defense →
  botnet-boss` (`CAMPAIGN_ORDER`, `campaign_prerequisite`,
  `campaign_mission_unlocked`).
- `POST /v1/cyber-defense/campaign/{mission_id}/complete` rejects a locked
  mission with `403 cyber_campaign_mission_locked`, before any reward is derived.
- `campaign_complete` now requires the **whole chain**, not just the final
  mission, which closes the final-mission-only hole where a client could claim
  only `botnet-boss` and unlock Operations.
- Legacy import is hardened too: it accepts only a **contiguous prefix** of the
  canonical order (walking `CAMPAIGN_ORDER` and stopping at the first gap or
  uncompleted mission), so a client cannot skip or import the boss alone. An
  imported completion is recorded as `first_clear_reward_settled`, so imported
  progress can never claim a first-clear reward later; it still grants only the
  fixed returning-defender career XP and no Bits. (Legacy progress remains
  inherently client-reported, so a fully fabricated contiguous chain can still
  migrate — it skips the tutorial but earns no retroactive currency.)

### 3. Settlement integrity (no server-side simulation)

- **Server-elapsed floor:** a run cannot settle before
  `OPERATION_MIN_ELAPSED_MS` (20 s) of server wall-clock time has passed.
- **Claimed-duration check:** `claimed_duration ≤ server_elapsed +
  OPERATION_DURATION_TOLERANCE_MS` (120 s). A long pause/resume is always fine.
- **Rate guard:** at most `OPERATION_RATE_MAX_SETTLED` (30) reward settlements
  per `OPERATION_RATE_WINDOW_MINUTES` (60) per learner; a real Operation takes
  minutes, so normal play is never blocked.
- Duplicate settlement stays idempotent (run-status guard) and cross-user
  settlement stays a 404.

### 4. Anti-repetition Operation selection

- `select_operation_template` (domain, deterministic) avoids the last two
  distinct template ids when alternatives exist, then avoids the immediately
  previous template when possible, and falls back to the whole eligible pool
  when only one template is eligible.
- The story confrontation never enters the random or offer pools.

### 5. Operation offers (`POST /v1/cyber-defense/operations/offers`)

- Returns up to three eligible offers, each with `offer_id`, template, title,
  adversary, estimated minutes, map, threat summary, and a reward preview at the
  requested (or recommended) Threat Level.
- Offers are **persisted** (`cyber_operation_offers`) and reused until they
  expire (30 min) or are consumed, so a re-render or second tab sees the same
  choices. The offer id doubles as the deterministic run seed.
- `POST /v1/cyber-defense/operations` accepts `offer_id`; the server starts
  exactly that offered template/adversary. Offer consumption and run creation
  happen in one transaction, so a failed start rolls the offer back and releases
  it instead of silently removing the player's choice. Ordinary templates can no
  longer be pinned directly (`400`), which closes the arbitrary-locked-template
  hole.
- The dashboard renders the offers, keeps one selected by default, and falls
  back to a single server-selected Operation if the offers endpoint is
  unreachable.

### 6. Threat Level choice for the confrontation

The operation chooser now shows Threat Level chips for the confrontation too.
The server validates the choice against the learner's unlocked level for every
start, so a lower, recommended, or higher unlocked level all work.

### 7. Branching Operation maps

Three new topologies join the catalog (`crates/domain/src/cyber_operation.rs`
and `apps/web/src/game/data/operationMaps.ts`):

- `dual-service` — API and application on parallel branches into the database.
- `identity-fork` — identity layer splits to the application and database.
- `service-mesh` — the edge reaches the API or the database directly.

Pre-existing templates now use them (`identity-breach → identity-fork`,
`web-assault → dual-service`, `availability-siege → service-mesh`). A parity test
asserts the Rust and TypeScript map-id sets match exactly, and generator
invariants are exercised on every map.

### 8. Tower Themes (permanent non-power Bits sink)

- Five themes (`neon-blue`, `amber-soc`, `violet-grid`, `minimal-dark`,
  `red-alert`), priced 180–1200 Bits, with **no gameplay effect**.
- `POST /v1/cyber-defense/cosmetics/{cosmetic_id}/purchase` charges Bits through
  the existing wallet ledger and is idempotent (a retry or a re-purchase of an
  owned theme charges nothing). `PUT /v1/cyber-defense/cosmetics/equipped`
  equips an owned theme or clears it.
- `GET /v1/cyber-defense/profile` returns `cosmetics` (owned/equipped) and
  `equipped_theme`; the Tower page has an **Appearance** section.

### 9. Legacy temporary-upgrade API removed

`POST /v1/cyber-defense/upgrades` (route, service, DTOs, OpenAPI entries) was
removed, along with the now-dead client spend queue (`state/bitSpends.ts`). The
shared wallet ledger infrastructure is unchanged.

## Files changed (high level)

- Domain: `cyber_defense.rs` (campaign order, integrity constants, cosmetics),
  `cyber_operation.rs` (snapshot types, branching maps, anti-repetition,
  offers, duration estimate, required-counter validation), `lib.rs` exports.
- DB: `migrations/20261003000005_cyber_integrity_replayability.{up,down}.sql`,
  `cyber_defense.rs` (offers, cosmetics, settled-count, recent identities,
  equipped theme).
- API: `services.rs`, `dto.rs`, `error.rs`, `openapi.rs`,
  `routes/cyber_defense.rs`, `lib.rs`.
- Web: `game/state/cyberProfile.ts`, `game/data/operationMaps.ts`,
  `game/data/towerEffects.ts`, `game/components/dashboard/OperationSetup.tsx`,
  `game/components/dashboard/CyberDashboard.tsx`,
  `pages/CyberDefenseOperationPage.tsx`, `pages/CyberDefenseTowerPage.tsx`,
  `layout/AppShell.tsx`, `styles.css`, generated `openapi.json` /
  `src/api/schema.d.ts`.

## Migrations

- `20261003000005_cyber_integrity_replayability` — `cyber_operation_offers`,
  `cyber_cosmetic_unlocks`, and `cyber_defense_profiles.equipped_theme`.

## New / changed APIs

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/cyber-defense/operations/offers` | Stable offer set (up to 3) |
| POST | `/v1/cyber-defense/operations` | Accepts `offer_id`; ordinary `template_id` pinning rejected |
| POST | `/v1/cyber-defense/cosmetics/{cosmetic_id}/purchase` | Idempotent Bits purchase |
| PUT | `/v1/cyber-defense/cosmetics/equipped` | Equip/clear an owned theme |
| GET | `/v1/cyber-defense/profile` | Adds `cosmetics`, `equipped_theme` |
| POST | `/v1/cyber-defense/campaign/{mission_id}/complete` | Enforces prerequisites |
| (removed) | `POST /v1/cyber-defense/upgrades` | Deleted with its client queue |

New error code: `cyber_campaign_mission_locked` (403).

## Tests added

- Domain: campaign order/prerequisites and full-chain completion, operation
  elapsed-plausibility bounds, anti-repetition (avoid last 2, single-template
  fallback, offer variety), branching-map parity/reachability, snapshot
  round-trip, cosmetics catalog.
- API: campaign order enforcement; offers stable/startable/invalid; offers
  require campaign; snapshot freezes SOC + Training Center; Engineering Lab
  allowance frozen; cosmetics purchase/equip/idempotency/insufficient; rate
  guard; legacy upgrade route gone; immediate settlement rejected; legacy import
  requires a contiguous prefix and an imported completion cannot claim a
  first-clear reward.
- DB: offer consumption rolls back with its transaction (so a failed start
  releases the offer).
- Web: map catalog parity + reachability; `towerProgressFromSnapshot`; offer
  selection sends `offerId`; confrontation keeps a chooseable Threat Level.

## Test results

- `cargo fmt --check` — clean.
- `cargo clippy --all-targets --all-features -- -D warnings` — clean.
- `cargo test --no-fail-fast` (local Postgres) — 44 test binaries pass; the only
  two failures are the same pre-existing, unrelated ones documented above
  (`daily_missions::completing_every_item_awards_the_bonus_exactly_once` and
  `family_guide::tracks_without_guides_still_load`). `adaptive-learn-domain` is
  94 tests; the Cyber Defense API suite is 34 tests and the Cyber Defense DB
  suite is 10 tests.
- `cd apps/web && pnpm typecheck` — pass.
- `cd apps/web && pnpm lint` — 0 errors (2 pre-existing `QuestionPrompt`
  warnings).
- `cd apps/web && pnpm test` — 136 files, 1095 tests pass.
- `cd apps/web && pnpm build` — pass.
- `cd apps/web && E2E_DATABASE_URL=… E2E_API_PORT=8099 E2E_WEB_PORT=5199 pnpm e2e`
  — 11 tests pass (Chromium), including the Cyber Defense offer/deploy flow and
  a run settled through the real API after aging past the integrity floor.

## Intentionally deferred

- **Cross-device story acknowledgement.** Completion is already
  server-authoritative; acknowledgement remains device-local
  (`game/persistence/storyAck.ts`). The planned schema is
  `cyber_story_acknowledgements(user_id, story_node_id, acknowledged_at)` with a
  `POST /v1/cyber-defense/story/{node_id}/acknowledge` endpoint that verifies the
  node is already unlocked and is idempotent, keeping the local value as an
  offline fallback that retries. This is lower priority than the integrity and
  choice work above.
- **Accelerated browser-combat E2E.** The existing E2E settles an Operation
  through the real API after aging the run past the integrity floor; it does not
  yet play the battle. A dev/E2E-only accelerated fixture (shorter render
  interval in `useGameEngine`, env-gated so production is unaffected) plus a
  pause-to-age step would let a test place defenses, start a wave, pause past
  20 s, resume at high speed, win, and assert the real settlement. Deferred to
  keep CI fast and avoid a flaky ~1–2 minute test.
- **Server-issued campaign run IDs.** Campaign completion still accepts
  client-reported result evidence (with server-derived rewards, prerequisite
  enforcement, idempotent `result_id`s, duration bounds, and the rate guard).
  Issuing server-side campaign run identities
  (`POST /v1/cyber-defense/campaign/{mission_id}/runs`) remains the known
  integrity limitation.

---

# Stage 2.3 — Gameplay Consistency Pass

Fixes four gameplay-consistency problems found after the Stage 2.2 integrity
work. No new progression, enemies, heroes, currencies, or game modes were added.

## 1. Branching maps genuinely branch

**Before:** `GameBoard` computed one `Road` from `primaryTargetNodeId` and
positioned every attack with `pointAtPosition(road, pathIndex + progress)`. On a
branching map, attacks on a non-primary route were drawn on the wrong road, and
only the primary route existed visually.

**Now:** a new pure module `apps/web/src/game/engine/roadGeometry.ts` turns the
map graph into render geometry:

- `buildMapRoadGeometry(map, layout)` builds one `RoadEdgeGeometry` per graph
  edge (bend points + length), plus node positions.
- `pathPointAt(geometry, path, position)` / `pathPoint(geometry, path,
  pathIndex, progress)` place an attack on **its own** `enemy.path`.
- `buildRoadPads(geometry)` builds deterministic pads along every edge,
  attached to the nearest endpoint so tower coverage matches the simulation.
- `nearestEdgeAnchor(geometry, point)` resolves a dropped/tapped hero to a
  concrete `{ from, to, fraction }` edge anchor.

`GameBoard` now draws every edge, positions every attack, effect, beam and hero
through these helpers, and never derives one attack's visual route from another
attack's target. The simulation was already graph-aware
(`enemy.path.indexOf(placed.nodeId)`), so the renderer simply agrees with it.

**Towers and branches.** A tower's `nodeId` is matched against each attack's own
path, so an Application tower can only damage attacks whose path traverses
Application. On a shared node (Edge/Internet) coverage legitimately overlaps.
Rate-limiter gates now also record the edge they span and only congest attacks
that traverse that edge.

**Heroes.** `HeroUnit` gains an optional edge anchor. An anchored hero only
fights attacks currently on the same logical edge; heroes deployed on a linear
map keep the previous behaviour. The local battle cache version was bumped so an
older cached run is safely discarded rather than misrendered.

**Retained single-route concepts.** `primaryTargetNodeId` is still used to choose
the main protected core, the spawn portal, and a reference path for legacy
(non-anchored) hero rendering. It no longer controls any attack's route or the
road geometry.

**Pads.** Pads are stable for a map (edge order + index), sit on both sides of
each edge, and every edge gets at least one. Merge areas inherit pads from both
incoming edges, which gives shared strategic positions without clutter.

## 2. The selected operator is the only Operation hero

**Before:** the Rust generator hardcoded
`available_heroes = DEFAULT_HERO_IDS`, so every Operation exposed both heroes
even though the run recorded one.

**Now:** `generate_operation` derives `available_heroes` from the requested
`hero_id` (falling back to the default roster only when no hero is requested).
`cyber_defense_start_operation` additionally asserts the invariant

```
selected hero == available_heroes == progression_snapshot.hero.hero_id
```

and fails loudly instead of settling XP to the wrong hero. `HeroBar` receives
only the selected hero because the Operation definition itself contains only
that hero — this is not a frontend hiding trick. Campaign hero rosters are
unchanged.

## 3. Pre-deploy → deployed lifecycle

A new migration adds `deployed_at TIMESTAMPTZ NULL` to `cyber_operation_runs`
(the result `status` column keeps its meaning). `NULL` means configurable;
a timestamp means the battle started and the configuration is frozen.

- `POST /v1/cyber-defense/operations/{run_id}/deploy` locks the row, requires
  `status == active`, sets `deployed_at = COALESCE(deployed_at, now())`, and is
  idempotent. No Bits/reward/simulation state is involved.
- `PUT .../loadout` now requires `status == active AND deployed_at IS NULL` and
  returns `409 cyber_operation_already_deployed` otherwise. The SQL update is
  guarded the same way.
- `CyberOperationRunDto` gains `deployed_at`.

**Client.** `CyberDefenseOperationPage` no longer toggles to battle on local
state alone. Clicking DEPLOY calls the endpoint first; the battle starts only on
success. On load, `run.deployed_at` decides whether the briefing/loadout is
shown or the battle resumes directly. Engineering Lab loadout editing is hidden
once deployed.

**Recovery.** A deployed run with no local battle cache reconstructs the initial
deployed battle from the immutable server config (preparation phase). If a
browser loses local combat state after substantial progress, that progress is
not recovered server-side; the player is never sent back to configuration to
work around it.

## 4. Equipped Tower themes are visible

`CyberDefenseRoot` (`apps/web/src/game/components/CyberDefenseShell.tsx`) wraps
every `/game` route and sets `data-cyber-theme` from
`profile.equipped_theme`. CSS in `styles.css` resolves per-theme `--cyber-*`
tokens and restyles the most visible surfaces:

- dashboard hero and eyebrow accents, primary buttons, the selected Operation
  offer card,
- Tower/appearance cards, the briefing schematic (same layout abstraction as the
  board),
- the board grid, road lines, and protected-core glow.

Theme tokens are cosmetic only; attack-type, health/danger, and defense-identity
colours are untouched. No equipped theme matches the previous default exactly;
Neon Blue is the explicit blue cosmetic. Equipping applies immediately (the
profile store is updated optimistically, then refreshed) with no reload and no
revert.

## Files changed (Stage 2.3)

- Rust: `crates/domain/src/cyber_operation.rs`; `crates/db/src/cyber_defense.rs`;
  new migration `20261003000006_cyber_operation_deploy`;
  `apps/api/src/{dto,error,services,lib,openapi}.rs`;
  `apps/api/src/routes/cyber_defense.rs`.
- Web engine: `engine/roadGeometry.ts` (new), `components/GameBoard.tsx`,
  `models/hero.ts`, `models/defense.ts`, `engine/simulation.ts`,
  `hooks/useGameEngine.ts`, `persistence/gameCache.ts` (cache version bump).
- Web briefing/offers: `components/OperationBriefing.tsx`,
  `components/dashboard/OperationSetup.tsx`, `data/operationMaps.ts`.
- Web lifecycle/theme: `pages/CyberDefenseOperationPage.tsx`,
  `state/cyberProfile.ts`, `components/CyberDefenseShell.tsx` (new),
  `layout/AppShell.tsx`, `styles.css`.

## API changes (Stage 2.3)

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/cyber-defense/operations/{run_id}/deploy` | Idempotent; freezes the run. |

`CyberOperationRunDto` adds `deployed_at`. New error code
`cyber_operation_already_deployed` (409).

## Tests added (Stage 2.3)

- `engine/roadGeometry.test.ts` — branches diverge after the fork, converge at
  Database, both branch edges and pads exist, every Operation map has geometry
  for every edge, mobile branch nodes do not overlap, linear maps unchanged.
- `engine/branching.test.ts` — an Application tower cannot damage an API-only
  attack but does damage an Application attack; an anchored hero only fights
  attacks on its own edge.
- `components/GameBoard.test.tsx` — every architecture edge is drawn and
  branch enemies render at different positions.
- `components/OperationBriefing.test.tsx` — a dual-service briefing shows both
  API and Application branches.
- `components/CyberDefenseShell.test.tsx` — the theme root reflects the equipped
  theme and stays default when none is equipped.
- `pages/CyberDefenseOperationPage.test.tsx` — briefing before deploy, battle
  only after a successful deploy, no battle on failure, deployed runs skip the
  briefing.
- `state/cyberProfile.test.ts` — an equipped theme reaches the shared profile.
- Rust domain/API/DB tests — generator roster matches the selected hero; deploy
  lifecycle (null → set → idempotent → loadout rejected → cross-user 404 →
  settled conflict); config locked after deploy.

## Verification (Stage 2.3)

- `cargo fmt --check` — clean.
- `cargo clippy --all-targets --all-features -- -D warnings` — clean.
- `cargo test --no-fail-fast` (local Postgres) — all Cyber Defense, domain, and
  DB suites pass. The only two failures are the same pre-existing, unrelated
  ones documented above.
- `cd apps/web && pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` —
  pass (141 test files; 1120 tests; lint has 2 pre-existing + 2 fast-refresh
  warnings, 0 errors).
- `E2E_DATABASE_URL=… E2E_API_PORT=8091 E2E_WEB_PORT=5184 pnpm e2e
  cyber_defense.spec.ts` — 3 tests pass, including the selected-hero and
  DEPLOY-locks-the-run flow.

## Intentionally deferred (Stage 2.3)

- **Branch-accurate gate congestion on shared source nodes.** Gates filter by
  their exact edge, but the numeric congestion position assumes path index ==
  node depth; harmless for the current maps.
- **Server-side recovery of substantial local combat progress.** As above, only
  the initial deployed battle is reconstructed.
