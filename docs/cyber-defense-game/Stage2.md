# Cyber Defense Tower — Stage 2 Implementation Plan

**Target branch:** start from the current `cyber-td` implementation  
**Stage 1:** existing five-mission Cyber Defense Tower game  
**Stage 2 goal:** turn Stage 1 into a persistent game that users can casually play for months without adding another game genre.

---

# 0. Execution plan

## Priority order

When two requirements conflict, optimize in this order:

1. **Fun**
2. **Long-term replayability**
3. **Meaningful use of Bits**
4. **Security education**

Security concepts still must hold true at all times.

## Hard constraints

Do not add any of these in Stage 2:

- Daily incidents
- Daily Cyber Defense missions
- Daily login rewards
- Streak-loss punishment
- Energy that blocks play
- Gacha
- Loot boxes
- Battle pass
- PvP
- Multiplayer
- Guilds
- Seasons
- Paid Bits
- A new standalone game mode
- A detailed SOC simulator

Do not use **Oracle** as a name for:

- adversary
- hacker
- boss
- company
- hero
- operation
- story character

Avoid names that intentionally mimic real security vendors, cloud providers, database companies, or real-world threat groups.

## Existing Stage 1 systems must be reused

Do not rebuild working Stage 1 systems.

Stage 1 already has:

- browser-side deterministic simulation
- five fixed missions
- towers/security controls
- tower placement
- mission-local credits
- tower upgrades
- waves
- bosses
- hero deployment
- hero combat
- hero cooldowns
- hero auras
- synergies
- hidden/revealed attacks
- postmortems
- star ratings
- mission caching/resume
- persistent Bits wallet infrastructure
- server-authoritative Bits debit endpoint
- local mission completion tracking

The main Stage 2 problem is **meta-progression and replayability**, not basic combat.

---

# 1. Baseline Repository Files

Before modifying anything, inspect these files.

## Frontend game

```text
apps/web/src/game/
  components/
    CyberDefenseGame.tsx
    GameBoard.tsx
    GameHud.tsx
    DefenseShop.tsx
    DefenseCard.tsx
    HeroBar.tsx
    HeroDetail.tsx
    MissionBriefing.tsx
    MissionResult.tsx
  data/
    attacks.ts
    defenses.ts
    heroes.ts
    missions.ts
    synergies.ts
    index.ts
  engine/
    combat.ts
    simulation.ts
    postmortem.ts
    pathing.ts
    layout.ts
  hooks/
    useGameEngine.ts
  models/
    attack.ts
    defense.ts
    hero.ts
    map.ts
    mission.ts
  persistence/
    gameCache.ts
    gameProgress.ts
    tutorial.ts

apps/web/src/pages/
  CyberDefensePage.tsx
  CyberDefenseMissionPage.tsx

apps/web/src/state/
  wallet.ts
  bitSpends.ts

apps/web/src/App.tsx
```

## Backend

```text
apps/api/src/
  dto.rs
  openapi.rs
  services.rs
  routes/
    cyber_defense.rs
    mod.rs

crates/domain/src/
  reward.rs
  lib.rs

crates/db/src/
  wallets.rs
  lib.rs

crates/db/migrations/
```

## Existing game specification

```text
docs/18-cyber-defense-game-spec.md
```

---

# 2. Stage 2 End State

At the end of Stage 2 the player loop should be:

```text
Open Cyber Defense
        ↓
Continue Defense
        ↓
Play next campaign mission OR repeatable Operation
        ↓
Tower Defense match
        ↓
Earn:
- Bits
- Career XP
- Hero XP
- adversary dossier progress
        ↓
Spend Bits on permanent Tower/HQ upgrades
        ↓
Level hero / career
        ↓
Unlock new strategic options / story / adversary behavior
        ↓
Play another Operation
```

Completing the current five fixed missions must no longer mean the game is finished.

---

# 3. Required Stage 2 Systems

Stage 2 must implement these systems:

1. Persistent Cyber Defense profile
2. Career XP and level
3. Real Cyber Defense Bits rewards
4. Mission-credit in-run tower upgrades
5. Persistent Tower/HQ upgrades
6. Persistent hero XP and levels
7. Repeatable Operations
8. Threat Level difficulty
9. Recommended Threat Level
10. Recurring fictional adversaries
11. Adversary rank
12. Threat Intel / dossier progress
13. Story progression
14. Cross-device persistence
15. Balance telemetry
16. Legacy Stage 1 migration

---

# 4. Implementation Order

Use this dependency order:

```text
STEP 0  Baseline verification
STEP 1  Domain/config foundations
STEP 2  Database schema
STEP 3  Cyber Defense profile read API
STEP 4  Remove persistent Bits from in-run upgrades
STEP 5  Server-authoritative Stage 1 mission rewards
STEP 6  Career XP + level
STEP 7  Persistent Tower/HQ
STEP 8  Hero progression
STEP 9  Operation data model
STEP 10 Deterministic operation generator
STEP 11 Operation start/complete API
STEP 12 Threat Level + recommended difficulty
STEP 13 Operation frontend flow
STEP 14 Recurring adversaries
STEP 15 Threat Intel / dossier
STEP 16 Story progression
STEP 17 Cyber Defense dashboard redesign
STEP 18 Legacy progress migration
STEP 19 Telemetry
STEP 20 Balance, security, accessibility, regression
```

Do not start Step 13 before Steps 9–12 work through the API.

---

# STEP 0 — Baseline Verification

## Goal

Prove the Stage 1 branch is healthy before Stage 2 changes.

## Tasks

### 0.1 Run backend checks

From repository root:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

### 0.2 Run frontend checks

```bash
cd apps/web
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run E2E if local DB/auth test setup is already available:

```bash
E2E_DATABASE_URL=postgres://app:app@localhost:5432/app pnpm e2e
```

### 0.3 Manually verify Stage 1

Confirm:

- `/game` loads
- current five missions appear
- mission locking works
- at least one mission starts
- tower placement works
- hero deployment works
- a tower can upgrade
- boss mission works
- mission result renders
- Bits wallet loads

### 0.4 Record known failures

If a baseline test already fails:

- do not silently fix unrelated code
- document it in the implementation notes
- distinguish pre-existing failures from Stage 2 regressions

## Exit criteria

Do not start Step 1 until the Stage 1 baseline is understood.

---

# STEP 1 — Add Stage 2 Domain and Balance Configuration

## Goal

Create one canonical place for Stage 2 progression rules before database or API code depends on them.

## Files to add

Recommended:

```text
crates/domain/src/cyber_defense.rs
```

Update:

```text
crates/domain/src/lib.rs
```

## 1.1 Create domain constants and pure functions

The domain module should own:

- career XP thresholds
- hero XP thresholds
- Tower upgrade cost rules
- fixed mission reward rules
- operation reward rules
- adversary rank thresholds
- threat-level bounds
- recommended-threat-level adjustment rules

Do not scatter these values through handlers or React.

Recommended functions:

```rust
pub fn career_level_from_xp(xp: i64) -> i32
pub fn hero_level_from_xp(xp: i64) -> i32
pub fn xp_for_career_level(level: i32) -> Option<i64>
pub fn xp_for_hero_level(level: i32) -> Option<i64>

pub fn tower_upgrade_cost(upgrade_id: &str, current_level: i32) -> Option<i64>

pub fn fixed_mission_reward(
    mission_id: &str,
    stars: i32,
    first_clear: bool,
) -> CyberReward

pub fn operation_reward(
    threat_level: i32,
    stars: i32,
    completed: bool,
    first_adversary_clear: bool,
) -> CyberReward

pub fn adversary_rank_from_progress(progress: i64) -> i32

pub fn recommend_threat_level(input: ThreatRecommendationInput) -> i32
```

Recommended reward shape:

```rust
pub struct CyberReward {
    pub bits: i64,
    pub career_xp: i64,
    pub hero_xp: i64,
}
```

## 1.2 Initial level curves

Do not over-optimize yet.

Use simple table/config-driven curves.

### Career level

Initial cap:

```text
30
```

Example threshold pattern:

```text
Lv 1: 0
Lv 2: 100
Lv 3: 230
Lv 4: 390
Lv 5: 580
...
```

Early levels should happen quickly.

### Hero level

Initial cap:

```text
20
```

Heroes should level faster than the overall career early on.

## 1.3 Threat Level bounds

Stage 2 initial public range:

```text
1–10
```

Write code so later stages can increase the maximum without schema changes.

## 1.4 Add domain tests

Add pure unit tests for:

- exact XP thresholds
- threshold - 1
- threshold + 1
- max level behavior
- invalid level
- negative XP handling
- reward monotonicity
- higher Threat Level never rewards less than lower Threat Level for the same result
- failed operation reward is lower than successful operation reward
- Tower cost is positive
- unknown Tower upgrade returns `None`
- recommended Threat Level remains in allowed bounds

## Exit criteria

All domain tests pass.

---

# STEP 2 — Add Stage 2 Database Schema

## Goal

Persist long-term Cyber Defense progression server-side.

## Migration

Create the next sequential migration pair in:

```text
crates/db/migrations/
```

Use the repository's next migration timestamp.

Example names only:

```text
YYYYMMDD000001_cyber_defense_stage2.up.sql
YYYYMMDD000001_cyber_defense_stage2.down.sql
```

Do not reuse this example timestamp if a newer migration exists.

## 2.1 Create `cyber_defense_profiles`

Suggested schema:

```sql
CREATE TABLE cyber_defense_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

    career_xp BIGINT NOT NULL DEFAULT 0 CHECK (career_xp >= 0),

    total_operations_completed INTEGER NOT NULL DEFAULT 0
        CHECK (total_operations_completed >= 0),

    highest_threat_level_cleared INTEGER NOT NULL DEFAULT 0
        CHECK (highest_threat_level_cleared >= 0),

    recommended_threat_level INTEGER NOT NULL DEFAULT 1
        CHECK (recommended_threat_level >= 1),

    active_story_chapter TEXT NOT NULL DEFAULT 'chapter-1',

    legacy_progress_imported BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Do not store career level if it can be derived safely from XP.

## 2.2 Create `cyber_hero_progress`

```sql
CREATE TABLE cyber_hero_progress (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hero_id TEXT NOT NULL,
    xp BIGINT NOT NULL DEFAULT 0 CHECK (xp >= 0),
    selected_talents JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, hero_id)
);
```

Do not store level separately unless there is a strong reason.

## 2.3 Create `cyber_tower_upgrades`

```sql
CREATE TABLE cyber_tower_upgrades (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    upgrade_id TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 0 CHECK (level >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, upgrade_id)
);
```

## 2.4 Create `cyber_adversary_progress`

```sql
CREATE TABLE cyber_adversary_progress (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    adversary_id TEXT NOT NULL,

    progress BIGINT NOT NULL DEFAULT 0 CHECK (progress >= 0),
    encounters INTEGER NOT NULL DEFAULT 0 CHECK (encounters >= 0),
    victories INTEGER NOT NULL DEFAULT 0 CHECK (victories >= 0),

    highest_threat_level_cleared INTEGER NOT NULL DEFAULT 0
        CHECK (highest_threat_level_cleared >= 0),

    dossier_flags JSONB NOT NULL DEFAULT '[]'::jsonb,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, adversary_id)
);
```

Rank should be derived from progress.

## 2.5 Create `cyber_story_progress`

```sql
CREATE TABLE cyber_story_progress (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    story_node_id TEXT NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, story_node_id)
);
```

## 2.6 Create `cyber_campaign_results`

Use this for authoritative one-time Stage 1 mission reward settlement.

```sql
CREATE TABLE cyber_campaign_results (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mission_id TEXT NOT NULL,

    completed BOOLEAN NOT NULL,
    best_stars INTEGER NOT NULL DEFAULT 0
        CHECK (best_stars BETWEEN 0 AND 3),
    best_health INTEGER NOT NULL DEFAULT 0
        CHECK (best_health >= 0),
    attempts INTEGER NOT NULL DEFAULT 0
        CHECK (attempts >= 0),

    first_clear_reward_settled BOOLEAN NOT NULL DEFAULT FALSE,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, mission_id)
);
```

## 2.7 Create `cyber_operation_runs`

```sql
CREATE TABLE cyber_operation_runs (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    seed BIGINT NOT NULL,
    template_id TEXT NOT NULL,
    adversary_id TEXT NOT NULL,
    hero_id TEXT,

    threat_level INTEGER NOT NULL CHECK (threat_level >= 1),

    status TEXT NOT NULL CHECK (
        status IN ('active', 'completed', 'failed', 'abandoned')
    ),

    generated_config JSONB NOT NULL,

    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,

    result_stars INTEGER CHECK (
        result_stars IS NULL OR result_stars BETWEEN 0 AND 3
    ),
    result_health INTEGER,
    duration_ms BIGINT,

    bits_awarded BIGINT NOT NULL DEFAULT 0,
    career_xp_awarded BIGINT NOT NULL DEFAULT 0,
    hero_xp_awarded BIGINT NOT NULL DEFAULT 0,

    reward_event_id UUID UNIQUE
);
```

Add indexes:

```sql
CREATE INDEX cyber_operation_runs_user_status_idx
ON cyber_operation_runs(user_id, status);

CREATE INDEX cyber_operation_runs_user_started_idx
ON cyber_operation_runs(user_id, started_at DESC);
```

## 2.8 DB module

Add:

```text
crates/db/src/cyber_defense.rs
```

Update:

```text
crates/db/src/lib.rs
```

The DB module should expose explicit functions, not business logic.

Examples:

```rust
get_or_create_profile(...)
get_hero_progress(...)
list_hero_progress(...)
list_tower_upgrades(...)
list_adversary_progress(...)
list_story_progress(...)

upsert_campaign_result(...)
create_operation_run(...)
get_operation_run_for_user(...)
complete_operation_run(...)

increment_career_xp(...)
increment_hero_xp(...)
increment_adversary_progress(...)

purchase_tower_upgrade(...)
```

Where multiple progression changes happen from one operation completion, perform them in one DB transaction.

## 2.9 DB tests

Add DB integration tests for:

- default profile creation
- no duplicate profile
- hero upsert
- Tower upgrade increment
- story progress idempotency
- campaign result best stars
- operation ownership
- duplicate reward event
- cross-user operation lookup rejected/not found
- completion transaction rollback on failure

## Exit criteria

Migrations apply and revert in local test DB.

```bash
cargo test
```

passes.

---

# STEP 3 — Build Cyber Defense Profile API

## Goal

Give the frontend one server-authoritative snapshot of the player's persistent Cyber Defense state.

## Files

Update:

```text
apps/api/src/dto.rs
apps/api/src/routes/cyber_defense.rs
apps/api/src/services.rs
apps/api/src/openapi.rs
apps/api/src/lib.rs or router wiring if required
```

## 3.1 DTOs

Add DTOs approximately like:

```rust
CyberDefenseProfileResponse
CyberCareerDto
CyberHeroProgressDto
CyberTowerUpgradeDto
CyberAdversaryProgressDto
CyberStoryProgressDto
```

The profile response should include:

```json
{
  "career": {
    "xp": 0,
    "level": 1,
    "rank": "Junior Security Analyst",
    "next_level_xp": 100
  },
  "bits_balance": 120,
  "tower_level": 1,
  "tower_upgrades": [],
  "heroes": [],
  "adversaries": [],
  "story": {
    "active_chapter": "chapter-1",
    "completed_nodes": []
  },
  "campaign": {},
  "highest_threat_level_cleared": 0,
  "recommended_threat_level": 1,
  "total_operations_completed": 0
}
```

## 3.2 Endpoint

Add:

```http
GET /v1/cyber-defense/profile
```

Authentication required.

## 3.3 Service behavior

On first request:

- ensure profile exists
- ensure rows for the two existing heroes are returned with XP 0 even if no DB row exists yet
- derive level/rank from domain functions
- load wallet balance
- load Tower upgrades
- load campaign results
- load adversaries
- load story progress

Do not make the frontend reconstruct authoritative levels itself.

## 3.4 OpenAPI

Register endpoint and schemas.

Then regenerate frontend API types:

```bash
cd apps/web
pnpm generate:api
```

Commit:

```text
apps/web/openapi.json
apps/web/src/api/schema.d.ts
```

## 3.5 Tests

Backend tests:

- requires auth
- creates default profile
- returns wallet balance
- returns default heroes
- user cannot view another user's profile
- level is derived correctly from XP

Frontend API typecheck must pass.

## Exit criteria

Authenticated browser can fetch one complete profile object.

---

# STEP 4 — Move In-Run Tower Upgrades to Mission Credits

## Goal

Stop charging permanent Bits for temporary tower upgrades.

This must happen before permanent Tower/HQ purchases are introduced.

## Current behavior to remove

Current frontend flow:

```text
handleUpgrade
→ upgradeBitsCost
→ spendBits
→ /v1/cyber-defense/upgrades
→ temporary tower level increase
```

Stage 2 behavior:

```text
handleUpgrade
→ check mission credits
→ deduct mission credits
→ temporary tower level increase
```

## 4.1 Update defense model

In:

```text
apps/web/src/game/models/defense.ts
```

Keep or rename:

```ts
upgradeCost(defense, level)
```

Make it represent **mission credits**.

Delete or deprecate:

```ts
upgradeBitsCost(...)
```

if no longer used anywhere.

## 4.2 Update simulation

In:

```text
apps/web/src/game/engine/simulation.ts
```

`upgradeDefense()` must:

1. find placed defense
2. validate max level
3. derive mission-credit upgrade cost
4. reject if `state.budget < cost`
5. deduct cost from `state.budget`
6. increment that exact placement's level

This immediately fixes the same-defense-type server sequencing problem because placement upgrades are entirely local mission state.

## 4.3 Update combat budget calculation

In:

```text
apps/web/src/game/engine/combat.ts
```

`computeSpentBudget()` must include:

- original placement costs
- mission-credit upgrade costs

This is necessary for star/budget scoring.

If current `PlacedDefense` does not preserve enough information to calculate cumulative upgrade spend, compute it from current level and canonical upgrade cost sequence.

## 4.4 Update `CyberDefenseGame.tsx`

Remove:

```text
spendBits
refundBits
flushBitSpends
useSettledBits
runIdRef for upgrade spending
```

from the tower-upgrade path.

Show:

```text
Upgrade — 120 credits
```

not Bits.

## 4.5 Update `DefenseShop`

The upgrade control should display mission-credit cost.

Use the same icon/label already used for mission budget.

Do not show Bits for temporary upgrades.

## 4.6 Backend deprecation

The current endpoint:

```http
POST /v1/cyber-defense/upgrades
```

should no longer be called by Stage 2 frontend.

If production compatibility is not needed, remove:

- route
- DTOs
- OpenAPI registration
- `cyber_defense_upgrade`
- `cyber_defense_upgrade_bits`
- obsolete tests

If compatibility is needed, leave it temporarily but mark it deprecated and unreachable from the new frontend.

Do not leave dead frontend queue behavior.

## 4.7 Update tests

Required:

- level 1 → 2 deducts mission credits
- insufficient mission credits rejects upgrade
- max level rejects upgrade
- two WAF placements upgrade independently
- upgrading one WAF does not upgrade the other
- upgrading affects spent-budget star calculation
- no wallet request occurs from an in-run upgrade
- removing upgraded tower refunds according to chosen Stage 2 rule

### Refund rule

Use one rule consistently.

Recommended:

```text
sell refund = 100% during prep before first wave
sell refund = 70% after combat begins
```

If implementing that is out of scope, keep existing refund behavior for Stage 2 and document it.

Do not accidentally create infinite mission-credit profit through upgrade/sell cycles.

## Exit criteria

A complete Cyber Defense mission can be played with network disconnected after it starts, including upgrades.

Persistent Bits never change when a temporary tower upgrades.

---

# STEP 5 — Settle Real Rewards for the Existing Five Missions

## Goal

Make the current campaign economically meaningful before adding repeatable Operations.

## 5.1 Create campaign completion endpoint

Add:

```http
POST /v1/cyber-defense/campaign/{mission_id}/complete
```

Request:

```json
{
  "stars": 3,
  "health": 84,
  "duration_ms": 320000
}
```

Do **not** accept:

```text
bits_awarded
xp_awarded
reward multiplier
```

from the client.

## 5.2 Server validation

Validate:

- known mission ID
- stars 0–3
- health >= 0
- plausible duration
- authenticated user

For Stage 2, the fixed campaign game still runs client-side.

Do not try to recreate the whole simulation server-side.

## 5.3 First-clear reward

Server determines:

- first clear
- best stars
- best health
- attempt count
- Bits reward
- career XP
- hero XP if appropriate

Recommended rule:

- first successful clear: full campaign reward
- replay success: smaller XP, no repeat first-clear bonus
- improved star record: optional small bonus
- failed attempt: small career/hero XP, no Bits or very small Bits

Do not let fixed mission replay become the best infinite Bits farm.

## 5.4 Wallet settlement

Reuse the wallet ledger.

Do not create a second Bits balance.

If the current `bit_transactions` schema requires a mission UUID and question-like item field, use a dedicated generated reward UUID/run UUID and machine-readable item/reason.

Do not fake learning-question IDs if a small schema extension would be cleaner.

If changing the wallet ledger is necessary, add a backwards-compatible migration.

## 5.5 Response

Return:

```json
{
  "campaign": {
    "mission_id": "ddos-basics",
    "completed": true,
    "best_stars": 3,
    "best_health": 84
  },
  "reward": {
    "bits": 60,
    "career_xp": 100,
    "hero_xp": 0
  },
  "bits_balance": 980,
  "career": {
    "xp": 310,
    "level": 3,
    "level_up": true
  }
}
```

## 5.6 Update MissionResult flow

After local match end:

1. render immediate local result
2. send completion request
3. show "Saving rewards..." state
4. on success, show settled reward values
5. reconcile Bits wallet from returned server balance
6. update Cyber Defense profile cache/store
7. if offline, show reward pending and retry later

Do not show a fake settled `+Bits` number before server confirmation.

## 5.7 Offline queue

If offline completion support is kept:

- store pending completion locally
- use run/result idempotency
- retry after reconnect
- show "Pending" instead of pretending it is settled

Do not allow repeated local reload to generate duplicate reward IDs.

## 5.8 Tests

Backend:

- first clear rewards once
- duplicate request does not double reward
- replay does not repeat first-clear reward
- unknown mission rejected
- malformed star count rejected
- Bits balance updates atomically
- XP updates atomically

Frontend:

- reward loading state
- reward settled state
- offline/pending state
- Bits reconcile
- duplicate rendering does not call completion twice

## Exit criteria

The current five missions now provide real persistent progress.

---

# STEP 6 — Career XP and Level UI

## Goal

Expose persistent overall progression.

## 6.1 Add frontend profile store/hook

Recommended:

```text
apps/web/src/game/state/cyberProfile.ts
```

or follow the repository's state convention.

Responsibilities:

- fetch `/v1/cyber-defense/profile`
- cache last known profile
- reconcile completion responses
- expose loading/error state
- avoid duplicate concurrent profile fetches

Do not put profile fetching directly into many components.

## 6.2 Career display

On `/game`, show:

```text
Security Analyst
Level 6
840 / 1,000 XP
```

Use proper progressbar accessibility attributes.

## 6.3 Rank names

Rank labels should be domain/data driven.

Initial suggestion:

```text
Lv 1–4    Junior Security Analyst
Lv 5–9    Security Analyst
Lv 10–14  Senior Security Analyst
Lv 15–19  Incident Responder
Lv 20–24  Threat Hunter
Lv 25–30  SOC Lead
```

## 6.4 Level-up presentation

On reward result:

```text
LEVEL UP
Security Analyst — Level 7
```

Keep it short.

Do not open a separate modal for every reward category.

## 6.5 Tests

- XP bar correct
- max-level display correct
- level-up shown only when level changes
- no negative progress width
- screen reader label contains current XP and level

## Exit criteria

A player can visibly make career progress by replaying Cyber Defense.

---

# STEP 7 — Persistent Tower / Cyber Defense HQ

## Goal

Give Bits a permanent, desirable use.

This is the primary Stage 2 Bits sink.

## 7.1 Add Tower data

Create:

```text
apps/web/src/game/data/towerUpgrades.ts
apps/web/src/game/models/tower.ts
```

Do not hard-code Tower definitions into components.

Suggested initial rooms:

```text
soc
threat_intelligence
training_center
engineering_lab
resilience_center
```

## 7.2 Tower upgrade definition

Suggested shape:

```ts
export interface TowerUpgradeDefinition {
  id: string
  roomId: TowerRoomId
  name: string
  description: string
  maxLevel: number
  levelBenefits: TowerLevelBenefit[]
  prerequisites?: TowerUpgradeRequirement[]
}
```

Frontend cost is display-only.

Server domain rules remain authoritative.

## 7.3 Initial effects

Keep effects modest and understandable.

### SOC

Lv 1:
- current behavior

Lv 2:
- show first upcoming wave in briefing

Lv 3:
- show two upcoming wave categories

Lv 4:
- expose a little more pre-wave information

### Threat Intelligence

Lv 1:
- show adversary specialty

Lv 2:
- reveal one Operation modifier before start

Lv 3:
- reveal boss presence before start

### Training Center

Lv 1:
- hero progression screen enabled

Lv 2:
- small hero XP bonus

Lv 3:
- talent respec unlocked or discounted

### Engineering Lab

Lv 1:
- one operation loadout customization feature

Lv 2:
- unlock one alternate strategic control option

Do not add many new towers yet.

### Resilience Center

Lv 1:
- improved recovery/postmortem information

Lv 2:
- modest recovery-oriented benefit

Do not create a universal health buff large enough to erase mistakes.

## 7.4 Tower purchase endpoint

Add:

```http
POST /v1/cyber-defense/tower/upgrades/{upgrade_id}
```

No cost in request body.

Server:

1. authenticates
2. gets current upgrade level
3. checks prerequisites
4. derives next-level cost
5. locks wallet
6. spends Bits
7. increments upgrade level
8. commits in one transaction
9. returns new wallet balance + Tower state

## 7.5 Tower level

Derive aggregate Tower level from room upgrade totals.

Example:

```text
Tower Level = 1 + sum(room levels)
```

or another pure rule.

Do not create a second Tower XP system.

## 7.6 Tower page

Add route:

```text
/game/tower
```

Add page:

```text
apps/web/src/pages/CyberDefenseTowerPage.tsx
```

Use:

- 2D CSS/SVG building
- one floor/room card per room
- current level
- next benefit
- cost
- upgrade button

Affordable upgrade should be visually obvious.

Avoid showing every future level at once.

## 7.7 Tests

Backend:

- successful purchase
- insufficient Bits
- max level
- prerequisite failure
- concurrent purchase
- duplicate idempotency
- user isolation

Frontend:

- affordability
- disabled max-level button
- Bits update after purchase
- Tower visual level update
- touch behavior

## Exit criteria

A player can earn Bits in Cyber Defense and permanently upgrade their HQ.

---

# STEP 8 — Hero Progression

## Goal

Turn the existing Security Engineer and SRE into long-term characters.

Do not create more heroes yet.

## 8.1 Extend hero data

Update:

```text
apps/web/src/game/data/heroes.ts
apps/web/src/game/models/hero.ts
```

Separate permanent progression definition from current mission runtime definition.

Recommended:

```ts
interface HeroProgressionDefinition {
  heroId: string
  maxLevel: number
  milestones: HeroMilestone[]
}
```

## 8.2 Initial milestone levels

Use:

```text
5
10
15
20
```

## 8.3 Talent choices

Security Engineer examples:

### Level 5

Choice A: Rapid Response
- cooldown moderately shorter

Choice B: Deep Hardening
- stronger control-effectiveness aura

### Level 10

Choice A:
- longer field duration

Choice B:
- stronger melee hit / attack cadence

SRE examples:

### Level 5

Choice A: Burst Capacity
- stronger reduction, shorter duration

Choice B: Sustained Capacity
- lower peak reduction, longer duration

Exact values should be conservative.

## 8.4 Mission runtime derivation

At match start:

1. load profile hero state
2. resolve base `HeroDefinition`
3. apply selected talent modifiers
4. create runtime hero stats
5. freeze them for the run

Do not have profile API calls alter hero stats mid-wave.

## 8.5 Hero XP award

Campaign/Operation completion returns hero XP.

Hero XP should go to:

- selected hero for the run
- or deployed hero if only one was used

Pick one rule and use it consistently.

Recommended:

```text
selected hero receives XP whether or not the ability was used
```

This avoids encouraging meaningless ability spam.

## 8.6 Hero progression page

Route:

```text
/game/heroes
```

Page:

```text
CyberDefenseHeroesPage.tsx
```

Show:

```text
Hero art
Level
XP bar
current ability
current talents
next milestone
```

## 8.7 Talent API

Add:

```http
PUT /v1/cyber-defense/heroes/{hero_id}/talents
```

Validate:

- hero exists
- milestone unlocked
- choice legal
- mutually exclusive choices not both active

For Stage 2, allow respec.

Recommended:

- free respec initially

Do not use Bits for respec until playtesting proves a reason.

## 8.8 Tests

- hero XP level derivation
- milestone unlock
- locked talent rejected
- invalid talent rejected
- hero runtime applies correct modifier
- talent cannot stack twice
- respec works
- selected hero gets completion XP once

## Exit criteria

The player has a persistent reason to keep using the existing two heroes.

---

# STEP 9 — Define Repeatable Operation Models

## Goal

Create data structures before generating Operations.

## Files to add

```text
apps/web/src/game/models/operation.ts
apps/web/src/game/data/operationTemplates.ts
apps/web/src/game/data/operationModifiers.ts
```

Backend should have equivalent Rust transport/domain structures.

## 9.1 Operation definition

Recommended generated shape:

```ts
interface GeneratedOperation {
  runId: string
  seed: number
  templateId: string
  adversaryId: string
  threatLevel: number

  title: string
  summary: string

  startingBudget: number
  startingHealth: number
  latencyTargetMs: number

  map: MissionMap
  availableDefenses: string[]
  availableHeroes: string[]

  waves: WaveDefinition[]
  modifiers: OperationModifierInstance[]

  rewardPreview: {
    bits: number
    careerXp: number
    heroXp: number
  }
}
```

The generated operation must be convertible into the existing `MissionDefinition`-like input needed by the Stage 1 engine.

Prefer an adapter instead of forking the engine.

## 9.2 Operation template

Recommended:

```ts
interface OperationTemplate {
  id: string
  titlePool: string[]
  mapId: string

  adversaryIds: string[]

  allowedThreats: AttackType[]
  requiredCounterDefenseIds: string[]

  baseBudget: number
  baseHealth: number
  baseLatencyTargetMs: number

  minWaves: number
  maxWaves: number

  allowedModifierIds: string[]
  maxModifiers: number
}
```

## 9.3 Initial templates

Create at least:

1. Identity Breach
2. Web Assault
3. Availability Siege
4. Mixed Intrusion
5. Recovery Crisis

These reuse current Stage 1 attacks/defenses.

Do not add new enemy types just to increase template count.

## Exit criteria

Templates compile and validation tests confirm all IDs exist.

---

# STEP 10 — Build Deterministic Operation Generator

## Goal

Generate replayable variety safely.

## Location

Prefer a pure shared/domain-style implementation.

Because the server issues authoritative Operation configuration, canonical generation should live in Rust.

Recommended:

```text
crates/domain/src/cyber_operation.rs
```

Frontend may have matching types/adapters but should not independently invent authoritative Operations.

## 10.1 Deterministic RNG

Use a small deterministic seeded PRNG implementation or a crate already acceptable for the workspace.

Do not use wall-clock randomness inside generation once seed is supplied.

Same:

```text
seed + template + threat level + adversary rank
```

must produce the same Operation.

## 10.2 Generation order

Use this exact sequence:

1. select template
2. select adversary
3. apply threat-level baseline
4. choose compatible modifiers
5. choose wave count
6. generate wave threat composition
7. calculate budget
8. calculate latency target
9. calculate health
10. validate counter availability
11. validate minimum viable build cost
12. emit generated config

Do not first randomize everything and then hope validation succeeds.

## 10.3 Threat scaling

Use a mix of:

- composition complexity
- wave count
- modifier count
- moderate enemy health multiplier
- moderate speed multiplier
- starting-budget pressure

Avoid HP-only scaling.

Suggested initial bands:

### Threat 1–3

- 3–4 waves
- one dominant attack family
- 0–1 modifier
- generous budget

### Threat 4–6

- 4–6 waves
- mixed attack families
- 1–2 modifiers
- moderate budget pressure

### Threat 7–10

- 5–7 waves
- mixed threats
- stronger adversary-specific behavior
- 2 modifiers
- boss chance where valid

## 10.4 Generation invariants

Every generated Operation must satisfy:

- at least one attack is present
- every attack ID exists
- every defense ID exists
- every hero ID exists
- map path reaches target
- at least one meaningful counter exists for dominant threat
- starting budget can afford a known viable opening
- Limited Arsenal cannot remove all viable counters
- no modifier duplicate
- no incompatible modifier combination
- boss has valid target/path
- wave count within bounds
- Threat Level within bounds

## 10.5 Solvability check

Do not solve Tower Defense optimally.

Use a cheaper invariant:

Each template defines a `canonicalOpening` or `minimumCounterPackage`.

Example:

```text
Identity Breach
minimum package:
- MFA
- optional Rate Limiter
```

Generator verifies the required package is:

- available
- placeable
- affordable

This catches obviously impossible runs.

## 10.6 Tests

Must include:

```text
same seed → exact same JSON
different seeds → variation
1000 generated operations → no invariant failure
threat 10 reward >= threat 1 reward
all required counters available
all maps path successfully
```

Add property-style loop tests even if no property-testing crate is introduced.

## Exit criteria

A test can generate 1,000 valid Operations with no impossible configuration.

---

# STEP 11 — Operation Start and Completion API

## Goal

Make repeatable Operations server-issued and rewards idempotent.

## 11.1 Start endpoint

Add:

```http
POST /v1/cyber-defense/operations
```

Request:

```json
{
  "requested_threat_level": 5,
  "hero_id": "security_engineer"
}
```

Optional:

```json
{
  "template_id": "identity-breach"
}
```

only when browsing an explicit Operation choice.

## 11.2 Start service flow

Server:

1. authenticate user
2. load Cyber profile
3. validate requested Threat Level
4. validate selected hero
5. select template/adversary
6. generate secure seed
7. generate deterministic Operation
8. persist complete generated config in `cyber_operation_runs`
9. return generated config

Do not regenerate on every GET from mutable data.

Persist the generated Operation snapshot so future balance/content updates do not change an in-progress run.

## 11.3 Active run behavior

If an active Operation exists:

Default `POST /operations` should return a conflict or active-run reference rather than silently create many runs.

Recommended response:

```text
409 ACTIVE_OPERATION_EXISTS
```

with active run ID.

The frontend then offers Resume or Abandon.

## 11.4 Operation read endpoint

Add:

```http
GET /v1/cyber-defense/operations/{run_id}
```

Return only if owned by current user.

## 11.5 Abandon endpoint

Add:

```http
POST /v1/cyber-defense/operations/{run_id}/abandon
```

No reward.

Abandoned run cannot later complete.

## 11.6 Complete endpoint

Add:

```http
POST /v1/cyber-defense/operations/{run_id}/complete
```

Request contains only result evidence:

```json
{
  "completed": true,
  "stars": 2,
  "health": 42,
  "duration_ms": 487000
}
```

Do not accept rewards or levels.

## 11.7 Completion transaction

One DB transaction should:

1. lock/load run
2. verify owner
3. verify status is active
4. validate plausible result
5. derive rewards
6. settle Bits
7. add career XP
8. add hero XP
9. update total Operations
10. update highest cleared Threat Level
11. update recommended Threat Level
12. update adversary progress
13. write reward values into run
14. mark completed/failed
15. commit

Duplicate completion request:

- returns previously stored result
- does not award again

## 11.8 Anti-cheat minimums

Validate:

- duration above minimum plausible time
- star range
- health range
- run active
- run belongs to user
- reward not already settled
- Threat Level from stored run, not request
- hero from stored run

Do not implement server-side simulation replay in Stage 2.

## 11.9 Tests

- start operation
- active-run conflict
- read own run
- cannot read another user's run
- abandon
- complete
- duplicate complete
- failed result
- Bits atomically awarded
- XP atomically awarded
- transaction rollback
- malformed result
- absurd duration rejected

## Exit criteria

A server-issued Operation can start, complete, and settle permanent rewards exactly once.

---

# STEP 12 — Threat Level and Recommended Difficulty

## Goal

Keep the game challenging for months without hidden rubber-banding.

## 12.1 Recommended Threat Level rule

Use recent results.

Recommended simple rule:

Track last 5 completed Operations.

Increase recommendation by 1 when:

- at least 4/5 are wins
- and average stars >= 2
- and average remaining-health ratio >= configured threshold

Decrease recommendation by 1 when:

- at least 3/5 are failures

Otherwise unchanged.

Clamp to:

```text
1–10
```

Do not change difficulty during a run.

## 12.2 Player control

Operation start UI should show:

```text
Recommended Threat: 5
```

Allow nearby choices:

```text
4  5  6
```

Advanced selector may expose the full unlocked range.

## 12.3 Unlock rules

Do not let a brand-new player immediately farm Threat 10.

Suggested unlocked maximum:

```text
max(
  recommended + 2,
  highest_cleared + 1
)
```

with a small campaign-based minimum.

## 12.4 Reward scaling

Higher Threat Level must give:

- more Bits
- more career XP
- more hero XP

But not exponentially.

Avoid making lower difficulty feel worthless.

## 12.5 Tests

- recommendation rises
- recommendation falls
- no change in mixed performance
- clamped min/max
- user may choose lower difficulty
- user may choose allowed higher difficulty
- locked Threat Level rejected server-side

## Exit criteria

Difficulty progression is understandable and player-controlled.

---

# STEP 13 — Operation Frontend Flow

## Goal

Let the player continue indefinitely after the five fixed missions.

## 13.1 Route

Add:

```text
/game/operations/:runId
```

Recommended page:

```text
apps/web/src/pages/CyberDefenseOperationPage.tsx
```

## 13.2 Reuse `CyberDefenseGame`

Do not duplicate the battle UI.

Create an adapter:

```ts
generatedOperationToMissionDefinition(operation)
```

Then render existing:

```tsx
<CyberDefenseGame ... />
```

Add only the minimum props needed for Operation completion.

Prefer extending result callbacks over branching deeply inside the engine.

## 13.3 Operation briefing

Show:

```text
Operation title
Adversary
Threat Level
Estimated time
Threat categories
Visible modifiers
Reward preview
Selected hero
```

Do not show exact hidden wave composition unless Tower upgrades allow it.

## 13.4 Operation completion

Result flow:

1. local postmortem
2. send result to server
3. await reward settlement
4. show one consolidated reward summary
5. update profile
6. CTA:
   - Continue Defense
   - Tower
   - Heroes

Primary CTA should be:

```text
CONTINUE DEFENSE
```

## 13.5 Resume

Operation game cache key must include:

```text
runId
```

not merely template ID.

Refresh must restore exact generated run.

## 13.6 Abandon

Add explicit:

```text
Abandon Operation
```

with confirmation only if progress would be lost.

Do not accidentally abandon on browser back.

## 13.7 Tests

- generated Operation adapts to mission engine
- start → fight → complete
- refresh resume
- result settlement
- duplicate render does not double complete
- abandon
- mobile layout
- auth guard

## Exit criteria

After current five missions, the player can click Continue Defense and play unlimited server-issued Operations.

---

# STEP 14 — Recurring Adversaries

## Goal

Give repeated Operations identity and progression.

## 14.1 Add adversary definitions

Create:

```text
apps/web/src/game/data/adversaries.ts
apps/web/src/game/models/adversary.ts
```

Equivalent canonical IDs must exist server-side.

Initial Stage 2 adversaries:

### `ghost-7`

Theme:

```text
identity
credentials
stealth
account compromise
```

Preferred threats:

- Credential Stuffing
- hidden attacks
- identity pressure

### `null`

Theme:

```text
web
application
injection
```

Preferred threats:

- SQL Injection
- XSS
- mixed application attacks

### `viper`

Theme:

```text
malware
impact
recovery
```

Preferred threats:

- Ransomware
- high-impact waves
- recovery pressure

Do not use Oracle.

## 14.2 Adversary rank

Rank represents **behavior/story progression**, not raw difficulty.

Suggested milestones:

```text
Rank 1
base operation behavior

Rank 2
new modifier becomes possible

Rank 3
dossier reveal

Rank 4
new mixed-wave pattern

Rank 5
boss-capable operation

Rank 7
story beat

Rank 10
major Stage 2 confrontation
```

Threat Level still controls numeric challenge.

## 14.3 Adversary progress

Award progress for:

- encounter
- successful Operation
- higher Threat success
- first boss clear

Do not regress rank.

## 14.4 Adversary-specific modifier pools

Examples:

### GHOST-7

- Hidden Traffic
- Credential Surge
- Identity Pressure

### NULL

- Mixed Vector
- Strict Latency
- Application Pressure

### VIPER

- Recovery Pressure
- Hardened Campaign
- Delayed Impact

All modifiers must have clear counterplay.

## 14.5 Tests

- rank derivation
- modifier unlock by rank
- rank does not force Threat Level
- invalid adversary rejected
- no `oracle` ID/name anywhere in Stage 2 content
- boss unlock occurs correctly

## Exit criteria

Two runs at the same Threat Level can feel strategically different because of adversary identity.

---

# STEP 15 — Threat Intel / Dossier

## Goal

Add collectible long-term progress without another currency.

Intel is **not spendable currency** in Stage 2.

## 15.1 Dossier flags

Examples:

```text
identity_specialist
uses_hidden_traffic
credential_surge_observed
rank_3_story_clue
boss_pattern_seen
highest_threat_5
```

Server controls unlocks.

## 15.2 Dossier page

Route:

```text
/game/intel
```

Page:

```text
CyberDefenseIntelPage.tsx
```

Display each adversary:

```text
GHOST-7
Rank 4
Dossier 45%

Known:
✓ Credential specialist
✓ Hidden traffic observed

Unknown:
?
?
```

Unknown entries should not expose hidden text in HTML.

## 15.3 Unlock presentation

At Operation result:

```text
NEW INTEL
GHOST-7: Credential Surge
```

Keep this inside the consolidated reward summary.

Do not add another modal.

## 15.4 Tests

- dossier flag unlock once
- hidden info absent before unlock
- unlock visible after profile refresh
- cross-device persistence

## Exit criteria

Repeated play creates collectible adversary knowledge.

---

# STEP 16 — Story Progression

## Goal

Give persistent context and future goals without interrupting gameplay.

## 16.1 Story data

Create:

```text
apps/web/src/game/data/story.ts
apps/web/src/game/models/story.ts
```

Server should own trigger evaluation or at minimum final completed-node state.

Suggested structure:

```ts
interface StoryNodeDefinition {
  id: string
  chapterId: string
  title: string
  body: string[]
  trigger: StoryTriggerDefinition
}
```

## 16.2 Stage 2 story structure

### Chapter 1 — First Contact

The existing five Stage 1 missions.

After current boss clear:

```text
Chapter 1 Complete
Operations unlocked
```

### Chapter 2 — Pattern Recognition

- repeatable Operations begin
- GHOST-7 appears
- first dossier clues

### Chapter 3 — Multiple Vectors

- NULL and VIPER appear
- attacks show coordination

### Chapter 4 — Targeted Research

- biolab-specific targeting becomes clear
- major adversary milestones

### Chapter 5 — Stage 2 climax

- major Operation / boss
- story hook remains open for Stage 3

## 16.3 Trigger types

Support only a small set:

```text
campaign_mission_completed
operations_completed
adversary_rank_reached
threat_level_cleared
story_node_completed
```

Do not add calendar/date triggers.

## 16.4 Story presentation

Use:

```text
2–4 short paragraphs maximum
```

Normal flow:

```text
story card
[Continue]
[Skip]
```

Skipped story is considered acknowledged.

Full text available later in Story Archive.

## 16.5 Story archive

Route:

```text
/game/story
```

Optional for first Stage 2 iteration, but data model should support it.

## 16.6 Tests

- Stage 1 boss unlocks Operations
- story node triggers once
- skip works
- story does not block gameplay if UI fails
- no date-based trigger
- trigger progress persists cross-device

## Exit criteria

The player understands that the original five missions are the beginning, not the ending.

---

# STEP 17 — Redesign `/game` as the Stage 2 Dashboard

## Goal

Make the persistent game loop obvious.

Do not make the mission list the main product after Stage 2.

## File

Refactor:

```text
apps/web/src/pages/CyberDefensePage.tsx
```

Create smaller components if needed.

Recommended:

```text
apps/web/src/game/components/dashboard/
  CareerSummary.tsx
  RecommendedOperation.tsx
  TowerSummary.tsx
  HeroSummary.tsx
  ThreatSummary.tsx
  CampaignSummary.tsx
```

## 17.1 Above-the-fold layout

Show:

```text
CYBER DEFENSE

Security Analyst — Lv 8
XP ███████░░

Tower Lv 6
Bits 1,840

Current Threat
GHOST-7 — Rank 4
```

Then one primary card:

```text
CONTINUE DEFENSE

Recommended Operation
Threat Level 5
~8 min

[CONTINUE DEFENSE]
```

## 17.2 Primary CTA logic

Use this order:

```text
if unfinished Operation:
    Resume Operation
else if Stage 1 campaign incomplete:
    Continue Campaign
else if unseen blocking story beat:
    Continue Story
else:
    Recommended Operation
```

Story should not permanently block gameplay.

## 17.3 Secondary navigation

Provide:

```text
Tower
Heroes
Threat Intel
Campaign
Operations
```

Do not show ten equally weighted buttons.

## 17.4 Campaign section

The five original missions remain accessible.

Show Chapter 1 progress.

Do not remove replay.

## 17.5 Tests

- new user gets first campaign mission
- partial campaign gets next campaign mission
- completed campaign gets Operation
- active Operation gets Resume
- Bits shown from server wallet
- mobile layout
- one primary CTA

## Exit criteria

A returning user can understand what to do within a few seconds.

---

# STEP 18 — Migrate Existing Stage 1 Local Progress

## Goal

Do not make current users lose their five-mission progress.

## Current source

```text
apps/web/src/game/persistence/gameProgress.ts
```

## 18.1 Migration endpoint

Add:

```http
POST /v1/cyber-defense/legacy-progress
```

Request may contain:

```json
{
  "missions": {
    "ddos-basics": {
      "completed": true,
      "stars": 3,
      "best_health": 80,
      "attempts": 2
    }
  }
}
```

## 18.2 Trust boundary

Local progress is untrusted.

Import only:

- completion state
- best stars
- best health
- attempts if useful

Do **not** issue retroactive Bits based solely on client-local progress.

Do not issue arbitrary XP from imported attempts.

Optional:

- grant a fixed one-time "returning defender" XP amount if at least one valid mission was previously completed

If doing this, server derives the amount.

## 18.3 Migration process

Frontend:

1. fetch profile
2. if `legacy_progress_imported == false`
3. read local Stage 1 progress
4. post valid known mission progress
5. await success
6. profile marks import complete
7. keep local data for compatibility but stop treating it as authoritative

## 18.4 Tests

- imports known mission
- ignores unknown mission
- clamps invalid values
- cannot import twice
- no Bits granted from arbitrary client stars
- empty progress still marks migration complete
- failure retries later

## Exit criteria

Existing Stage 1 users retain campaign completion.

---

# STEP 19 — Telemetry for Balancing

## Goal

Collect only enough data to find boring, dominant, impossible, or overly grindy systems.

Do not add invasive tracking.

## Required events

At minimum:

```text
cyber_dashboard_view

cyber_operation_offered
cyber_operation_started
cyber_operation_resumed
cyber_operation_completed
cyber_operation_failed
cyber_operation_abandoned

cyber_threat_level_selected

cyber_defense_placed
cyber_defense_upgraded
cyber_defense_removed

cyber_hero_selected
cyber_hero_deployed

cyber_tower_upgrade_purchased
cyber_hero_level_up
cyber_hero_talent_selected

cyber_adversary_rank_up
cyber_dossier_unlock
cyber_story_seen
```

## Useful dimensions

Do not send raw personal data.

Useful fields:

```text
run_id
template_id
adversary_id
threat_level
hero_id
defense_id
wave
result
stars
duration_bucket
```

## Required product metrics

Be able to answer:

1. What percentage of campaign completers start an Operation?
2. What percentage play a second Operation?
3. How many Operations per session?
4. Which templates are abandoned?
5. Which Threat Levels have extreme fail rates?
6. Which defenses are nearly always selected?
7. Which defenses are almost never selected?
8. Which heroes dominate?
9. How quickly do users earn and spend Bits?
10. How long between Tower upgrades?
11. Are users stuck with large Bits balances and nothing desirable to buy?
12. Do users stop immediately after Stage 1?

## Exit criteria

Stage 2 can be tuned from real behavioral data without storing unnecessary personal information.

---

# STEP 20 — Final Balance, Security, Accessibility, and Regression Pass

## Goal

Do not ship Stage 2 just because the systems compile.

---

## 20.1 Fun / replayability review

Play at least:

```text
20 generated Operations
```

covering:

- all three adversaries
- Threat 1
- Threat 3
- Threat 5
- Threat 7
- Threat 10
- each initial template

Look for:

- repetitive opening build
- dominant towers
- hero that is always correct
- operation that is obviously unwinnable
- operation that is trivial
- modifier combinations that feel unfair
- rewards that feel too slow

---

## 20.2 Economy review

Test a simulated progression path.

### Casual target

Assume:

```text
2–5 Operations per week
```

Target:

```text
8–16 weeks of visible Stage 2 progression
```

Do not artificially time-gate it.

Check:

- early permanent purchase every ~1–2 sessions
- mid-game purchase every ~2–4 sessions
- later purchase every ~3–6 sessions

If a required upgrade needs 20 repetitive runs, reduce grind.

If everything can be purchased in one evening, increase depth/cost.

---

## 20.3 Dominant-strategy review

Test whether one build wins unrelated content.

Example failure condition:

```text
WAF + MFA + Backup
wins almost every template regardless of threats
```

If this occurs:

- adjust operation composition
- improve specialized defenses
- tune costs
- tune ranges
- tune modifiers

Do not "fix" balance by teaching false security relationships.

---

## 20.4 Security-content review

Verify these remain true:

### SQL Injection

- Parameterized Queries remain strongest/root-cause-style counter
- WAF helps but does not "fix" SQLi

### XSS

- XSS Protection remains primary
- WAF helps
- do not describe CSP alone as universal XSS prevention

### Credential Stuffing

- MFA is strong
- Rate Limiting helps but is not equivalent to MFA

### Least Privilege

- reduces impact/blast radius
- does not magically prevent initial compromise

### Backup

- recovery control
- does not prevent ransomware infection

### Monitoring / IDS

- detection/support
- does not automatically stop every attack

### Segmentation if introduced

- limits lateral movement
- does not prevent all initial access

---

## 20.5 Authorization/security tests

For every Stage 2 endpoint:

- auth required
- no IDOR
- user cannot mutate another user's run
- unknown content IDs rejected
- reward values not accepted from client
- Bits cannot become negative
- XP cannot become negative
- duplicate completion idempotent
- duplicate purchase idempotent
- malformed JSON rejected
- SQLx binds values; no dynamic unsafe SQL
- all numeric inputs bounded

---

## 20.6 Accessibility

Verify:

- keyboard navigation on meta pages
- focus visible
- no required hover
- touch targets large enough
- no information conveyed only by color
- reduced motion respected
- pause still works
- story skippable
- reward summary does not auto-dismiss
- XP bars have accessible labels
- Tower buttons identify level/cost
- mobile screen remains usable at narrow width

---

## 20.7 Performance

Active simulation must still:

- run entirely in browser
- avoid per-tick backend calls
- avoid repeated profile fetches during a wave
- avoid operation-state server writes every frame

API calls should happen primarily at:

```text
dashboard load
operation start
operation complete
Tower purchase
talent selection
legacy migration
```

---

## 20.8 Full test suite

Run:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

Then:

```bash
cd apps/web
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Then E2E if available:

```bash
E2E_DATABASE_URL=postgres://app:app@localhost:5432/app pnpm e2e
```

Do not mark Stage 2 complete with newly introduced failing tests.

---

# 5. Detailed Stage 2 Acceptance Test

A coding agent should use this as the final functional walkthrough.

## Fresh user

1. Sign in.
2. Open `/game`.
3. See Career Level 1.
4. See Tower Level 1.
5. See Bits.
6. Primary CTA points to first Stage 1 mission.
7. Complete first mission.
8. Server awards actual Bits and XP.
9. Refresh.
10. Reward remains.
11. Replay mission.
12. First-clear reward is not duplicated.
13. Complete the remaining four missions.
14. Boss clear marks Chapter 1 complete.
15. Operations unlock.

## First Operation

16. Dashboard now shows recommended Operation.
17. Select Security Engineer.
18. Select recommended Threat Level.
19. Start Operation.
20. Server creates persistent run.
21. Refresh during wave.
22. Run restores.
23. Upgrade a tower.
24. Mission credits decrease.
25. Persistent Bits do not decrease.
26. Complete Operation.
27. Server awards Bits.
28. Career XP increases.
29. Security Engineer XP increases.
30. Adversary progress increases.
31. Result shows one consolidated reward summary.

## Tower

32. Open Tower.
33. Purchase affordable SOC upgrade.
34. Bits decrease server-side.
35. Refresh.
36. Upgrade remains.
37. Start another Operation.
38. SOC benefit is visible.

## Hero

39. Gain enough Hero XP for milestone.
40. Open Heroes.
41. Choose talent.
42. Start Operation.
43. Talent changes hero runtime behavior.
44. Respec.
45. New behavior replaces old choice cleanly.

## Adversary

46. Play multiple Operations against GHOST-7.
47. Rank increases.
48. Dossier unlock appears.
49. New modifier becomes possible.
50. Lower Threat Level remains selectable.

## Story

51. Trigger story milestone.
52. Story shown once.
53. Skip works.
54. Story log/progress remains after refresh.
55. Story does not block future Operations.

## Cross-device/server persistence

56. Clear browser local storage.
57. Sign in again.
58. Career remains.
59. Bits remain.
60. Tower remains.
61. Hero XP remains.
62. Dossier remains.
63. Story remains.
64. Campaign completion remains.

If this walkthrough works, the core Stage 2 loop is complete.

---

# 6. Important Test Matrix

Use this matrix as a minimum.

| System | Happy path | Failure path | Idempotency | Cross-device |
|---|---|---|---|---|
| Campaign reward | yes | invalid result | yes | yes |
| Operation start | yes | active run exists | N/A | yes |
| Operation complete | yes | malformed result | yes | yes |
| Tower purchase | yes | insufficient Bits | yes | yes |
| Career XP | yes | invalid award source | via run | yes |
| Hero XP | yes | invalid hero | via run | yes |
| Hero talent | yes | locked talent | safe update | yes |
| Adversary rank | yes | invalid adversary | via run | yes |
| Dossier | yes | invalid flag | yes | yes |
| Story | yes | unmet trigger | yes | yes |
| Legacy import | yes | invalid local data | one-time | yes |

---

# 7. Suggested File Additions

This is a recommendation, not a requirement if repository conventions suggest a cleaner structure.

## Domain

```text
crates/domain/src/
  cyber_defense.rs
  cyber_operation.rs
```

## Database

```text
crates/db/src/
  cyber_defense.rs
```

## API

Prefer extending current:

```text
apps/api/src/routes/cyber_defense.rs
```

If it becomes too large, split:

```text
apps/api/src/routes/cyber_defense/
  mod.rs
  profile.rs
  campaign.rs
  operations.rs
  tower.rs
  heroes.rs
  legacy.rs
```

Do not split prematurely before the route file becomes difficult to manage.

## Frontend models/data

```text
apps/web/src/game/models/
  operation.ts
  tower.ts
  adversary.ts
  progression.ts
  story.ts

apps/web/src/game/data/
  operationTemplates.ts
  operationModifiers.ts
  towerUpgrades.ts
  adversaries.ts
  heroProgression.ts
  story.ts
```

## Frontend pages

```text
apps/web/src/pages/
  CyberDefenseOperationPage.tsx
  CyberDefenseTowerPage.tsx
  CyberDefenseHeroesPage.tsx
  CyberDefenseIntelPage.tsx
```

Optional:

```text
CyberDefenseStoryPage.tsx
CyberDefenseOperationsPage.tsx
```

## Frontend state

```text
apps/web/src/game/state/
  cyberProfile.ts
  cyberOperations.ts
```

Keep active simulation state in the existing game engine rather than duplicating it here.

---

# 8. Stage 2 Data Rules

The following must be server-authoritative:

```text
Bits
Career XP
Career level
Hero XP
Hero talents
Tower upgrade level
Adversary progress
Adversary rank
Dossier unlocks
Story progress
Operation identity
Operation seed
Operation Threat Level
Operation reward
```

The following can remain local/transient:

```text
enemy position
tower targeting
projectiles/effects
wave timer
hero cooldown inside current run
mission credits
temporary placed tower levels
pause state
sound settings
```

---

# 9. Stage 2 UX Rules

Follow these for every new screen.

## Primary action

There should be one obvious next action.

On dashboard:

```text
CONTINUE DEFENSE
```

## Progressive disclosure

Do not show:

```text
all hero talent math
all 10 Threat Levels
all Tower future levels
all adversary unknown tactics
all story history
```

on the main screen.

Show only the next useful information.

## Short session support

Normal Operation target:

```text
5–12 minutes
```

Boss/major Operation:

```text
10–18 minutes
```

## Failure

Failure should answer:

```text
What got through?
Why?
What can I change?
```

Failure should not remove permanent progress.

## Return after a long break

A player returning after three weeks should not see:

```text
You lost your streak.
You missed 21 rewards.
Your energy expired.
```

They should see:

```text
Welcome back.
Continue Defense.
```

---

# 10. Stage 2 Game Design Rules

## Avoid dominant strategies

Every Operation should make context matter.

Good trade-offs:

```text
specialist defense vs broad defense
detection vs direct mitigation
save credits vs spend early
low latency vs more protection
Security Engineer vs SRE
safe Threat Level vs higher reward
```

Bad state:

```text
same three towers win every operation
```

## Persistent progression should not replace skill

Do not create:

```text
Tower Lv 20 = +500% all damage
```

Permanent growth should mainly provide:

- information
- options
- specialization
- small efficiency
- hero customization
- visible ownership

## No forced grinding

Do not require repetitive trivial runs to progress.

If players intentionally farm Threat 1 because it is fastest, reduce low-threat reward efficiency relative to recommended difficulty.

Do not set reward to zero just because the player chose lower difficulty.

---

# 11. Research-Based Design Notes

These are implementation constraints, not separate research tasks.

## Game psychology

Use:

- competence: clear mastery and level progression
- autonomy: hero/talent/Tower/difficulty choices
- ownership: persistent Tower growth
- understandable challenge
- short feedback loops

Do not rely on:

- FOMO
- random paid rewards
- punishment for absence

## UI/UX

Keep:

- visible status
- consistent controls
- undo/respec where reasonable
- one clear CTA
- recognition over memorization
- progressive disclosure

## Security education

Use established relationships from:

- NIST CSF 2.0
- NIST SP 800-207
- NIST SP 800-61 Rev. 3
- MITRE ATT&CK
- OWASP Top 10 / Cheat Sheets
- CIS Controls
- CISA guidance

Do not turn those frameworks into extra required UI complexity.

---

# 12. Stage 2 Definition of Done

Stage 2 is done only when:

## Replayability

- original five missions are still playable
- finishing them unlocks repeatable Operations
- Operations can be generated indefinitely
- Threat Level supports long-term challenge
- at least three adversaries create different strategic patterns

## Progression

- career XP persists
- career level persists
- Security Engineer levels
- SRE levels
- hero talents persist
- Tower upgrades persist
- adversary rank persists
- dossier persists
- story persists

## Bits

- Cyber Defense awards real Bits
- Bits are server-authoritative
- Bits buy permanent Tower progression
- temporary tower upgrades use mission credits
- zero Bits never prevents the player from playing

## UX

- `/game` has one primary Continue Defense action
- active runs resume
- short sessions remain practical
- no daily requirement exists
- no forced wait exists
- story is skippable
- mobile remains functional

## Security

- rewards cannot be client-selected
- purchases cannot overdraft wallet
- duplicate completion cannot duplicate rewards
- users cannot mutate another user's progression
- all server writes validate content IDs

## Quality

- current Stage 1 tests still pass
- new Stage 2 tests pass
- operation generator passes invariant tests
- full fresh-user walkthrough passes
- cross-device persistence works

---

# 13. Commit / Checkpoint Strategy

Prefer small checkpoints.

Suggested checkpoints:

```text
stage2: add cyber defense progression domain rules

stage2: add cyber defense persistence schema

stage2: add cyber defense profile API

stage2: move in-run upgrades to mission credits

stage2: settle campaign rewards server-side

stage2: add career progression UI

stage2: add persistent tower upgrades

stage2: add hero progression

stage2: add operation models and generator

stage2: add operation APIs

stage2: add operation frontend

stage2: add adversary progression and intel

stage2: add story progression

stage2: redesign cyber defense dashboard

stage2: migrate legacy game progress

stage2: add balancing telemetry

stage2: final balance and regression pass
```

After each checkpoint:

```bash
cargo test
(cd apps/web && pnpm typecheck && pnpm test)
```

Run the full lint/build suite at major milestone boundaries.

---

# 14. Coding Agent Final Instruction

Do not interpret Stage 2 as:

> "Add lots of new content."

Interpret Stage 2 as:

> "Turn the existing Cyber Defense Tower game into a persistent progression system with indefinite repeatable Operations."

The five Stage 1 missions, current towers, current attacks, and two current heroes are enough to build the first long-running version.

The most important successful transition is:

```text
Stage 1:

Mission 1
→ Mission 2
→ Mission 3
→ Mission 4
→ Mission 5
→ Done


Stage 2:

Campaign
→ Operation
→ permanent progress
→ Operation
→ Tower upgrade
→ Operation
→ hero level
→ adversary evolution
→ story
→ harder Operation
→ continue indefinitely
```

Build that loop first.

Do not add another game type until this loop is fun and durable.
