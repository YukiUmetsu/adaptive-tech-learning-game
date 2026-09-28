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

`POST /v1/cyber-defense/upgrades` (in-run upgrade spending) is left mounted for
compatibility but is no longer called by the Stage 2 frontend; in-run upgrades
now use mission credits only (Step 4).

### Migrations

- `20261003000001_cyber_defense_stage2` — profiles, hero progress, Tower
  upgrades, adversary progress, story progress, campaign results, operation runs.
- `20261003000002_cyber_reward_events` — one-off reward idempotency.
- `20261003000003_cyber_operation_active_unique` — at most one active Operation
  per learner.
- `20261003000004_cyber_telemetry` — batched balance telemetry.

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
- **Operation template browsing** is not built; the dashboard starts a
  server-selected Operation (or the story-gated confrontation). The API already
  accepts an optional `template_id`.
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


