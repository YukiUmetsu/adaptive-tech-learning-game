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
- `20261003000007_cyber_operation_deploy_cleanup` — invalidates active runs that
  existed before `deployed_at` (see Stage 2.3.1).

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

- ~~**Branch-accurate gate congestion on shared source nodes.** Gates filter by
  their exact edge, but the numeric congestion position assumes path index ==
  node depth; harmless for the current maps.~~ **Fixed in Stage 2.3.1** (see
  below): gates now carry their edge and fraction, and congestion is measured on
  the enemy's own route.
- **Server-side recovery of substantial local combat progress.** As above, only
  the initial deployed battle is reconstructed.

---

# Stage 2.3.1 — Branching and Deployment Correctness

A narrow consistency pass over Stage 2.3. No new heroes, attacks, defenses,
adversaries, currencies, progression, or game modes. No change to the linear
Stage 1 maps.

## 1. Settlement requires deployment

**Before:** `/complete` settled any `active` Operation, even one that had never
been deployed (`deployed_at IS NULL`). The plausibility clock used `started_at`,
so time spent reading the briefing and configuring the Engineering Lab counted as
combat runtime.

**Now:** `cyber_defense_complete_operation` locks the run and requires
`status == "active" && deployed_at IS NOT NULL`. An undeployed run returns
`409 cyber_operation_not_deployed`; the server never auto-deploys during
settlement. Plausibility is measured from `deployed_at`:

```text
combat_elapsed_ms = now - deployed_at
claimed_duration_ms <= combat_elapsed_ms + OPERATION_DURATION_TOLERANCE_MS
combat_elapsed_ms >= OPERATION_MIN_ELAPSED_MS
```

The 120 s tolerance absorbs clock skew, browser throttling, tab backgrounding,
and network latency; the 20 s floor remains deliberately conservative. A
duplicate completion is still idempotent (run-status guard).

## 2. Stable logical pad identity

**Before:** `buildRoadPads()` derived the pad count from rendered edge length
(`round(edge.length / PAD_STEP)`, capped at 3) and numbered pads with a global
`pad-N` sequence. Desktop and mobile draw the same edge at different pixel
lengths, so a resize/device change could change the pad count and move every
later id, re-pointing a saved tower at another branch.

**Now:** pad identity is a map-structure decision, independent of x/y:

- `LogicalRoadPad { id, edgeFrom, edgeTo, slot, side, fraction, nodeId, partnerId }`.
- A fixed number of pad groups per edge (`2`, with an optional per-edge override)
  determines slots — never pixel length.
- Stable ids are `edge--{from}--{to}--{slot}-{side}`, for example
  `edge--edge--app--0-left`. Globally sequential `pad-N` ids are gone.
- `buildLogicalRoadPads(map)` produces the identity; `renderRoadPads(geometry,
  logical)` projects it onto the current geometry. Only the rendered x/y (and
  facing angle) may differ between orientations.

Saved placements live only in the local battle cache (never server-persisted),
and the cache version was bumped from 5 to 6 so an old snapshot with `pad-*` ids
is discarded rather than restored onto the wrong branch.

## 3. Edge-aware ("anchored") towers

**Before:** normal towers matched only `enemy.path.indexOf(placed.nodeId)`. A
tower built on `Edge -> Application` whose nearest pad node was the shared `Edge`
node could damage API-only traffic on `Edge -> API`.

**Now:** every graph-pad placement records a logical `DefenseAnchor { from, to,
fraction }` (`PadSelection` now carries the fraction as well). Branch-local,
path-based blocking and mitigation controls only affect traffic that traverses
their anchored route; a control whose anchored edge the enemy's path does not
traverse returns no position and is skipped. Intentionally global controls
(detection, system-wide damage reduction, recovery) keep their global behavior,
so this rule is scoped to path-local controls rather than "all towers".

- A branch-local path control on `Edge -> Application` (for example a WAF or
  Traffic Blocker) does not damage or mitigate an API-only enemy, even though
  both paths contain `Edge`.
- A control anchored to a genuinely shared edge (for example `Internet -> Edge`)
  still covers both branches, because both paths traverse it. That shared
  coverage is intended.
- Support controls are ordered by each control's actual logical route position,
  not a bare shared-node index, so a support on one branch does not boost a
  target on an unrelated branch.
- Global controls are unaffected by anchors: Monitoring/IDS reveals hidden
  traffic and projects its aura everywhere, Least Privilege reduces system
  damage everywhere, and Backup / Resilience recovery restore system health
  everywhere (see the table below).

### Control semantics: placement-specific vs global

| Control | Scope | Why |
|---|---|---|
| Blocking/mitigation towers (WAF, Blocker, Input Validation, …) | Edge-anchored | They filter the traffic that physically passes their placement. |
| Rate-limiter gate | Edge-anchored | It spans one road edge and only congests traffic that traverses it. |
| Monitoring / IDS `revealHidden` | Global | It is an architecture-wide detection capability, not a chokepoint. |
| Monitoring / IDS `auraBonus` | Global | Small system-wide effectiveness bonus by design. |
| `damageReduction` (Least Privilege, SRE ability) | Global | It protects the system, not one route. |
| Recovery/Backup, Resilience Center emergency recovery | Global | System health, not route-specific. |

These global effects were intentionally **not** edge-restricted.

## 4. Branch-accurate gate queue rendering

**Before:** the simulation filtered gates by their edge, but `GameBoard` queued
enemies using only the gate's numeric `position` (a `nodeDepth + fraction`
approximation), so an enemy on a branch the gate ignores could still be drawn
queued behind it.

**Now:** `gateQueue` carries `{ id, from, to, fraction }`. Both the simulation and
the renderer resolve the gate's position on the enemy's own route with the shared
`pathEdgeIndex` / `edgePositionOnPath` helpers in `engine/pathing.ts`:

```text
route index i  = pathEdgeIndex(enemy.path, gate.from, gate.to)   // -1 if absent
gate position  = i + gate.fraction   (simulation and renderer agree)
```

An enemy whose path does not traverse the gate edge is never queued or offset.
Legacy gates without an anchor fall back to the previous numeric position, but
the cache bump means no such gate is restored.

## 5. Multi-target Operation briefing

**Before:** the briefing reduced every attacked node to one `primaryTarget` and
highlighted one target (plus every Database by node type).

**Now:** `operationTargetNodeIds(catalog, run)` collects every unique target from
the attacks actually present in `operation.waves` (never inferred from node
types). `TargetMap` highlights all of them, and the caption reads `Target:
Database` for one target or `Targets: Application, Database` for several. A
single protected-core visual is still placed at the deepest attacked node;
`primaryTargetNodeId` is retained only for that core art, the spawn portal, and
the legacy hero reference path — it no longer determines an enemy route, tower
coverage, or briefing targets.

## 6. Branching maps: real choices, not decoration

Reviewed the three branching templates against their attacks:

- **`web-assault` → `dual-service`** has a genuine two-branch reason: SQL
  Injection (Database, via API) and XSS (Application) attack different targets,
  so a single chokepoint no longer covers everything.
- **`identity-breach` → `identity-fork`** is intentionally mostly a single
  identity route; the fork exists for topology variety and the `auth -> db`
  shortcut is a rarely-used alternate. No attack was invented to force it.
- **`availability-siege` → `service-mesh`** keeps its natural edge/API DDoS
  targets; `edge -> db` is left as an alternate path rather than given a
  nonsensical DDoS target just to exercise a lane.

No template, map, wave composition, attack, or defense was changed in this pass.
Unused alternate edges are documented here as intentional, not filled.

## 7. Legacy run migration decision

The product has not launched and there is no reliable signal that an old
`active`, `deployed_at IS NULL` run had actually progressed, so the simple,
honest choice was taken over a fragile heuristic: migration
`20261003000007_cyber_operation_deploy_cleanup` marks pre-existing active
pre-deploy runs `abandoned`. New runs are unaffected (configurable until the
player explicitly DEPLOYs). The down migration is intentionally a no-op because
the abandoned state cannot be safely reversed.

## 8. Documentation correction

The Stage 2.3 notes implied renderer/simulation parity was already complete. It
was not: towers, gate congestion, and the briefing still used node/global-depth
approximations. After this pass, the route an enemy is on, the branch a tower,
hero, or gate exists on, and the queue visual all resolve through the same
`pathing.ts` edge helpers. This is a *shared-helper* invariant for branch-local,
path-based effects on the current maps — it deliberately does not claim that
every effect is branch-scoped, because detection, system-wide damage reduction,
and recovery are global by design.

## Files changed (Stage 2.3.1)

- Rust: `crates/domain/src/cyber_defense.rs` (plausibility docs/semantics),
  `apps/api/src/{error,services}.rs`, migration
  `20261003000007_cyber_operation_deploy_cleanup`.
- Web engine: `engine/pathing.ts` (shared `pathEdgeIndex` /
  `pathContainsEdge` / `edgePositionOnPath`), `engine/roadGeometry.ts`
  (logical vs rendered pads), `engine/simulation.ts` (anchored towers, support
  ordering, edge-based gate congestion), `models/defense.ts`
  (`DefenseAnchor`), `hooks/useGameEngine.ts`, `components/GameBoard.tsx`,
  `components/CyberDefenseGame.tsx`, `components/OperationBriefing.tsx`,
  `persistence/gameCache.ts` (version 6).
- Docs: this section.

## API changes (Stage 2.3.1)

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/cyber-defense/operations/{run_id}/complete` | Rejects `deployed_at IS NULL` with `409 cyber_operation_not_deployed`; plausibility measured from `deployed_at`. |

New error code: `cyber_operation_not_deployed` (409).

## Tests added (Stage 2.3.1)

- API: undeployed completion rejected even after aging; created 10 min ago but
  deployed 5 s ago rejected; deployed past the floor accepted; duplicate
  completion idempotent. Existing flow/deploy/climax tests deploy before settling.
- Engine: anchored `Edge -> Application` tower cannot damage an API-only enemy
  through the shared `Edge` node but damages an `Application` enemy; a tower on
  the genuinely shared `Internet -> Edge` edge covers both branches; pad ids,
  edges, fractions, and node associations are identical across horizontal and
  vertical layouts for every Operation map; the dual-service `Edge -> Application`
  pad stays on that edge on mobile; repeated generation is stable.
- Component: `GameBoard` reports stable logical pad identity, keeps a placed
  tower present across desktop → mobile, and queues only the enemy that traverses
  a branch gate.
- Briefing: a multi-target Operation lists and highlights both Database and
  Application but not the traversed (unattacked) API node; single-target copy
  stays singular.
- E2E: a direct completion before DEPLOY is rejected through the real API, then
  DEPLOY and settlement proceed.

## Verification (Stage 2.3.1)

- `cargo fmt --check` — clean.
- `cargo clippy --all-targets --all-features -- -D warnings` — clean.
- `cargo test -p adaptive-learn-domain -p adaptive-learn-db -p
  adaptive-learn-api --no-fail-fast` (local Postgres) — domain 95, DB Cyber
  Defense 11, API Cyber Defense 38, and the wider API suites pass. The only
  failure is the pre-existing `daily_missions::
  completing_every_item_awards_the_bonus_exactly_once` documented above.
  (A full `cargo test` was also attempted; it confirmed the same pre-existing
  `content::family_guide::tracks_without_guides_still_load` failure, then stalled
  on the unrelated `glossary` content test binary, which hangs in this
  environment and is not touched by this pass. That run was stopped.)
- `cd apps/web && pnpm typecheck` — pass.
- `cd apps/web && pnpm lint` — 0 errors (2 pre-existing `QuestionPrompt` warnings).
- `cd apps/web && pnpm test` — 141 files, 1129 tests pass.
- `cd apps/web && pnpm build` — pass.
- `cd apps/web && E2E_DATABASE_URL=… E2E_API_PORT=8091 E2E_WEB_PORT=5184 pnpm
  e2e cyber_defense.spec.ts` — 3 tests pass, including the new "cannot complete
  before DEPLOY" assertion and the deployed resume flow.

## Intentionally deferred (Stage 2.3.1)

- **Server-side recovery of substantial local combat progress** — unchanged from
  Stage 2.3.
- **In-browser viewport-resize E2E assertion** — the desktop/mobile tower
  stability is covered by deterministic engine/component tests rather than a
  resize-driven E2E, which would be timing-flaky for little extra signal.

---

# Stage 2.3.2 — Range and Visual Parity

Small correctness/polish pass. No new heroes, attacks, defenses, maps,
currencies, progression, or game modes; no backend change.

## 1. Rate-limiter visuals match the simulation

**Before:** the simulation queued only swarm traffic behind Rate Limiter gates
(`isSwarm` was private to `simulation.ts`), but `GameBoard.queuedPoint` applied
its queue offset based only on gate edge, enemy path, and gate position. A
non-swarm attack (XSS, SQL Injection) moving normally through the simulation
could still be drawn shifted backward at a gate.

**Now:** the swarm rule lives in one pure helper,
`combat.ts#isSwarmAttack(attackId, catalog)`, used by both the simulation's gate
queue and the renderer. `queuedPoint` returns the unshifted point for any
non-swarm attack. Visually queued traffic therefore always satisfies both
conditions the simulation requires: swarm **and** traversing the gate edge.

## 2. Anchored tower range uses the actual pad position

**Before:** anchoring already prevented cross-branch targeting, but range was
still centered on `enemy.path.indexOf(placed.nodeId)` — the nearest node — so a
tower at `Edge -> Application @ 0.75` fought from the position of the `app`
node, not from its visible pad.

**Now:** a pure `simulation.ts#defensePositionOnPath(placed, enemy)` returns the
control's logical route position:

```text
anchored:   edgePositionOnPath(path, anchor.from, anchor.to, anchor.fraction)
unanchored: path.indexOf(nodeId)   (legacy fallback)
not on route: null
```

`applyTowerDamage` and `computeEngagements` center `coverageContains` on that
position. A control whose anchored edge the enemy never traverses returns `null`
and is skipped, so branch-local path controls stay on their branch.

## 3. Support controls are ordered by real route position

Traffic Analyzer (`supportTargetId: traffic_blocker`, ×5) now boosts a Traffic
Blocker only when the Analyzer's `defensePositionOnPath` is strictly earlier than
the Blocker's on the enemy's own route. Same edge (0.25 → 0.75) boosts; reverse
(0.75 → 0.25) does not; a different branch does not; a genuinely shared upstream
edge still supports a downstream Blocker.

## 4. Global controls stay global

Only branch-local, path-based blocking/mitigation range and support ordering use
positions. These remain intentionally global and were not edge-restricted:
Monitoring/IDS `revealHidden` and `auraBonus`, `damageReduction` (Least
Privilege / SRE ability), Backup and Resilience Center recovery. The control
semantics table in the Stage 2.3.1 section still applies.

## 5. Target-intelligence policy (explicit)

Which systems are under attack is **baseline incident information**, known before
any Tower upgrade, and remains visible at SOC Lv0. The SOC gates wave
composition, families, exact counts, intensity, and boss presence; Threat
Intelligence gates the adversary specialty and modifiers. Target knowledge and
wave knowledge are separate concepts, and this is now stated in the briefing
code and covered by a test. No behavior was changed.

## 6. Linear-map behavior

Anchored towers on linear maps now also center on their exact pad fraction, so a
tower's firing window shifts by ±0.25 to ±0.75 path segments depending on which
slot it occupies. This is the intended consequence of the fix. No range constant
was changed; the full frontend suite (including Stage 1 simulation tests) stays
green, so no compensating rebalance was needed.

## Files changed (Stage 2.3.2)

- Web engine: `engine/combat.ts` (`isSwarmAttack`), `engine/simulation.ts`
  (`defensePositionOnPath`, position-centered range/support, shared swarm helper),
  `engine/pathing.ts` and `engine/roadGeometry.ts` (scoped doc wording),
  `components/GameBoard.tsx` (swarm guard in `queuedPoint`, approximate-range
  note), `components/OperationBriefing.tsx` (target-intel policy comment).
- Docs: this section; corrected overbroad wording in Stage 2.3.1 section 3/8.

No API, DB, or migration changes.

## Tests added (Stage 2.3.2)

- Engine: `defensePositionOnPath` centers on the anchor fraction (0.75 → route
  1.75), different windows at 0.25 vs 0.75, `null` across branches, shared-edge
  coverage, legacy node-index fallback; Traffic Analyzer support ordering
  (same-route boost, reverse no-boost, cross-branch no-boost, shared upstream
  boost).
- Component: `GameBoard` queues swarm traffic on the gate edge but leaves
  non-swarm traffic on the same edge unchanged, and leaves swarm on another
  branch unchanged.
- Briefing: a multi-target Operation shows `Targets: Database, Application` at
  SOC Lv0 while wave details stay hidden.
- `pnpm test` — 141 files, 1139 tests pass.

## Verification (Stage 2.3.2)

- `cargo fmt --check` — clean.
- `cargo clippy --all-targets --all-features -- -D warnings` — clean.
- `cargo test -p adaptive-learn-api --test cyber_defense` — 38 pass;
  `-p adaptive-learn-db --test cyber_defense` — 11 pass;
  `-p adaptive-learn-domain` — 95 pass. No Rust changed this pass; the same two
  pre-existing, unrelated failures documented above are unaffected.
- `cd apps/web && pnpm typecheck` — pass.
- `cd apps/web && pnpm lint` — 0 errors (2 pre-existing `QuestionPrompt` warnings).
- `cd apps/web && pnpm test` — 141 files, 1139 tests pass.
- `cd apps/web && pnpm build` — pass.
- `cd apps/web && E2E_DATABASE_URL=… E2E_API_PORT=8092 E2E_WEB_PORT=5185 pnpm
  e2e` — 12 tests pass (Chromium): Cyber Defense (3), learning (6),
  questions (1), Settings (2).

## Intentionally deferred (Stage 2.3.2)

- **Graph-distance range visualization.** The board's range ellipse stays an
  approximate placement hint centered on the control's real pad position; a true
  path-distance coverage overlay is out of scope.
