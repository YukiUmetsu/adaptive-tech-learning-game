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

- **Tower in-run effects are descriptive only.** Rooms persist and are
  purchasable, and the SOC's "show the next wave" behaviour already exists in the
  HUD, but the other listed benefits (Threat Intel modifier/boss reveal,
  Training Center hero XP bonus, Engineering Lab loadout, Resilience postmortem)
  are not yet wired into the engine.
- **Story presentation** is the archive page plus a "Story advanced." line in the
  settlement summary. There is no dedicated story card modal; skipped/unseen
  tracking is a local acknowledgement (`game/persistence/storyAck.ts`).
- **Operation template browsing** is not built; the dashboard starts a
  server-selected Operation. The API already accepts an optional `template_id`.
- **Telemetry** is wired to dashboard views, Operation start/resume/complete/
  abandon, and threat selection. The remaining required events (defense placed/
  upgraded/removed, hero selected/deployed, Tower purchase, talent selection,
  adversary rank up, dossier unlock, story seen) are defined in the allowlist but
  not all emitted yet.
- **E2E** was not run (no local auth/E2E setup was exercised); verification is
  unit and integration tests plus a production build.
