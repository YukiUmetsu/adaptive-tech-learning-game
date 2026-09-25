# Cyber Defense Tower Game
## Implementation Specification for AI Coding Agents

Status: MVP specification  
Purpose: Add a lightweight, mostly frontend cybersecurity tower-defense game to the adaptive learning platform.

---

## 1. Product Goal

Build a short, replayable **cyber defense tower game** where:

- Enemies represent cyber attacks.
- Towers represent real security controls.
- The player protects an application architecture instead of a fantasy castle.
- The player must consider:
  - protection effectiveness,
  - implementation cost,
  - runtime latency,
  - where a defense can be placed,
  - basic defense-in-depth.
- The game reinforces security concepts already learned in the platform.
- Gameplay should remain easy to understand and should **not become a full security simulator**.

The game should feel like a tower-defense game first, with educational security concepts embedded naturally into the mechanics.

---

## 2. Core Design Principles

### 2.1 Keep the game simple

The MVP should avoid excessive simulation.

Do **not** initially add:

- complex economic simulation,
- detailed enterprise architecture,
- dozens of security metrics,
- realistic SOC workflows,
- advanced attack graphs,
- detailed compliance systems,
- complicated networking rules,
- highly granular tower configuration,
- multiplayer,
- PvP,
- real-time backend simulation.

A player should understand the core game within roughly one minute.

### 2.2 Security concepts must remain reasonably accurate

Do not teach misleading mappings such as:

- encryption stops SQL injection,
- logging prevents attacks,
- WAF permanently fixes vulnerable code,
- prompt filters fully solve prompt injection.

The game may simplify reality, but simplifications must preserve the main security lesson.

### 2.3 Mostly frontend

The game simulation should run entirely in the browser.

The server should mainly handle:

- persistent Bits balance,
- unlocked content,
- permanent inventory,
- rewards,
- optional session/result validation.

Avoid API calls during active gameplay.

### 2.4 Knowledge should matter more than grinding

Bits can unlock additional options, cosmetics, or horizontal upgrades.

Avoid progression where a player wins only because tower damage became extremely high.

---

# 3. Core Fantasy

The player is defending a digital system.

Example map:

```text
Internet
   |
   v
 Edge
   |
   v
 API
   |
   v
 Application
   |
   v
 Database
```

Enemies move through the architecture toward protected assets.

Examples:

- DDoS attacks the edge or availability.
- SQL Injection attempts to reach the database through the application.
- XSS targets the application/user-facing layer.
- Credential Stuffing targets authentication.
- Prompt Injection targets AI systems and tool access.

Security controls are placed on compatible nodes.

Example:

```text
Internet
   |
 [WAF]
   |
   v
 API
   |
 [Input Validation]
   |
   v
 Application
   |
 [Parameterized Queries]
   |
   v
 Database
```

---

# 4. MVP Gameplay Loop

Each mission should take approximately **3 to 8 minutes**.

## Flow

```text
1. Mission briefing
2. See architecture map
3. Spend budget to place defenses
4. Start wave
5. Enemies travel through system
6. Defenses mitigate attacks
7. Player can add/upgrade defenses between waves
8. Boss/final wave
9. Mission result
10. Short security postmortem
11. Reward Bits / XP
```

Do not interrupt the player with long lessons during combat.

Educational feedback should be short and contextual.

---

# 5. Player Objectives

For MVP, keep the main objective simple:

> Protect the system until all waves are complete.

Track only a small set of visible metrics.

Recommended MVP metrics:

```text
SYSTEM HEALTH
LATENCY
BUDGET
```

Optional later metric:

```text
SECURITY SCORE
```

Do not initially expose detailed Confidentiality / Integrity / Availability meters during normal gameplay. These may be added later if useful.

---

# 6. System Health

The protected system has health.

Example:

```text
System Health
████████░░ 80%
```

If an enemy reaches its target, system health is reduced.

Different attack types may deal different health damage.

The mission fails when health reaches zero.

This deliberately keeps the first version easy to understand.

---

# 7. Budget

Each mission starts with a fixed budget.

Example:

```text
Budget: 1,200 credits
```

Placing and upgrading towers costs credits.

Credits are **mission-local currency**, separate from persistent Bits.

Do not use Bits directly for every tower placement.

Reason:

- Players should be able to retry missions without losing permanent currency.
- The game remains a strategy puzzle.
- Bits remain a platform progression reward.

> **Implementation note.** Control *placement* uses mission credits, as above.
> *Upgrading* a deployed control spends persistent Bits, settled
> server-side and idempotently (`POST /v1/cyber-defense/upgrades`) and requiring
> an account. This keeps a retry free while giving platform progression a sink;
> see the Spending section of [Gamification](07-gamification.md).

---

# 8. Latency

Some defenses increase request latency.

Example:

```text
Current latency: 92 ms
Target: < 150 ms
```

A mission can allow the player to survive while still receiving a lower architecture score for excessive latency.

For MVP:

- latency does not need to affect individual projectiles,
- simply calculate total latency from active controls,
- show a warning if the target is exceeded.

Example:

```text
⚠ Latency target exceeded
Current: 174 ms
Target: 150 ms
```

Do not make latency calculation overly realistic.

---

# 9. Towers / Security Controls

A tower represents a real security defense.

Each tower should have a small set of attributes.

Required:

```ts
interface DefenseDefinition {
  id: string
  name: string
  category: DefenseCategory
  description: string

  cost: number
  latencyMs: number

  allowedPlacements: NodeType[]

  effectiveness: Record<AttackType, number>

  upgradeIds?: string[]
}
```

Effectiveness values should normally be from:

```text
0.0 = ineffective
1.0 = extremely effective
```

The game engine converts effectiveness into mitigation.

---

# 10. Initial Defense Set

Keep the MVP tower list small.

Recommended initial defenses:

## Edge / Network

### WAF

Strong against:

- SQL Injection
- XSS

Moderate against:

- malicious bots

Weak against:

- credential misuse
- insider attacks

### Rate Limiter

Strong against:

- simple DDoS
- brute force
- credential stuffing

Possible drawback:

- small latency,
- legitimate users may be affected later.

### DDoS Protection

Strong against:

- DDoS

Placement:

- edge only.

---

## Application

### Input Validation

Useful against:

- malformed/malicious inputs,
- some injection-style attacks.

### Parameterized Queries

Extremely strong against:

- SQL Injection.

Placement:

- application/database access path.

Important educational rule:

A WAF can reduce SQL injection traffic, but Parameterized Queries should be the stronger long-term defense.

### Output Encoding / CSP

Strong against:

- XSS.

For MVP these may be combined into one defense called:

```text
XSS Protection
```

to avoid unnecessary complexity.

---

## Identity

### MFA

Strong against:

- credential stuffing,
- stolen passwords,
- account takeover.

### Least Privilege

Does not necessarily stop the initial attack.

Instead, it reduces damage when certain attacks reach protected systems.

For MVP this can simply reduce enemy damage by a percentage.

---

## Detection

### Monitoring / IDS

Does not directly block most attacks.

Effects:

- reveals hidden enemy type,
- may increase effectiveness of other defenses,
- may provide earlier warning.

Keep this mechanic simple in MVP.

---

## Recovery

### Backup

Does not block attacks.

Possible MVP effect:

- one-time restore when system health reaches a threshold,
- or reduce damage from the ransomware boss.

Do not build a complex backup/restore simulation initially.

---

# 11. Enemy / Attack Model

Required fields:

```ts
interface AttackDefinition {
  id: string
  name: string
  description: string

  attackType: AttackType

  speed: number
  health: number
  systemDamage: number

  pathType: PathType

  tags?: string[]
  hiddenUntilDetected?: boolean
}
```

For MVP, enemy health is allowed as a game abstraction.

Security defenses should still be described as "mitigating", "blocking", or "filtering" rather than literally shooting bullets.

Visual effects may still resemble tower-defense attacks.

---

# 12. Initial Enemy Set

Start with approximately 5 normal attack types.

## DDoS Swarm

Behavior:

- many weak enemies,
- high quantity,
- attacks availability,
- rate limiting and DDoS protection are effective.

## SQL Injection

Behavior:

- medium health,
- attempts to reach database,
- WAF helps,
- Parameterized Queries are highly effective.

## XSS

Behavior:

- attacks application/frontend path,
- WAF helps,
- XSS Protection is highly effective.

## Credential Stuffing

Behavior:

- attacks authentication,
- Rate Limiter helps,
- MFA is highly effective.

## Prompt Injection

Behavior:

- appears only on AI-oriented maps,
- attacks LLM/agent route,
- AI security controls are required.

Prompt Injection can be introduced after the initial web-security tutorial if needed.

---

# 13. Bosses

Bosses should test a concept, not simply have huge health.

For MVP, implement only 1 or 2 bosses.

## Ransomware Boss

Characteristics:

- high damage,
- difficult to fully prevent,
- Backup reduces final damage,
- Least Privilege reduces impact.

## Botnet DDoS Boss

Characteristics:

- summons many smaller attack units,
- Rate Limiter helps,
- DDoS Protection is highly effective.

Later possibilities:

- Supply Chain Attack
- Zero Day
- Insider Threat
- Prompt Injection Boss
- RAG Poisoning

Do not implement these until the core game is enjoyable.

---

# 14. Placement Rules

The architecture consists of nodes.

Example node types:

```ts
type NodeType =
  | "edge"
  | "auth"
  | "api"
  | "application"
  | "database"
  | "ai"
  | "tool"
```

A defense can only be placed on compatible nodes.

Example:

```text
WAF
Allowed:
✓ edge
✓ api

Not allowed:
✗ database
```

Attempting invalid placement should show a short explanation.

Example:

```text
Parameterized Queries belong in the application/database access layer.
```

This is an important educational mechanic.

---

# 15. Architecture Maps

Keep maps visually understandable.

Do not create large graph-editing systems.

For MVP, maps should be predefined.

Example:

```text
Internet -> Edge -> API -> App -> Database
```

AI example:

```text
User -> API -> LLM -> Agent -> Tool
                  \
                   -> RAG
```

Each node has predefined screen coordinates.

Example:

```ts
interface MapNode {
  id: string
  type: NodeType
  x: number
  y: number
  label: string
}
```

Connections:

```ts
interface MapEdge {
  from: string
  to: string
}
```

---

# 16. Waves

Level data defines waves.

Example:

```json
{
  "waves": [
    {
      "delayMs": 0,
      "groups": [
        {
          "attackId": "ddos_swarm",
          "count": 12,
          "spawnIntervalMs": 400
        }
      ]
    },
    {
      "groups": [
        {
          "attackId": "sql_injection",
          "count": 5,
          "spawnIntervalMs": 900
        }
      ]
    }
  ]
}
```

Keep wave behavior deterministic where practical.

---

# 17. Defense Resolution

Do not create a complex security probability simulator.

A simple model is acceptable.

Possible implementation:

```ts
effectiveDamage =
  towerBasePower *
  effectivenessAgainstAttack
```

Or:

```ts
remainingAttackHealth -=
  defensePower * effectiveness
```

For non-blocking controls such as Least Privilege:

```ts
finalSystemDamage *= damageReduction
```

For recovery:

```ts
systemHealth += restoreAmount
```

Keep the rules easy for developers and players to understand.

---

# 18. Defense-in-Depth Bonus

Add a small, simple synergy mechanic.

Example:

```text
WAF + Parameterized Queries

Defense in Depth
+10% protection against SQL Injection
```

Recommended MVP synergies:

```text
WAF + Parameterized Queries
Rate Limiter + MFA
Monitoring + WAF
Least Privilege + MFA
Backup + Least Privilege
```

Do not create dozens of hidden combinations.

Show active synergy clearly in the UI.

---

# 19. Heroes

Heroes are optional emergency abilities.

They should not replace good architecture.

For MVP, implement 2 heroes.

## Security Engineer

Ability:

```text
Emergency Rule
Temporarily increases one selected defense's effectiveness.
```

## SRE

Ability:

```text
Emergency Scale
Temporarily reduces DDoS damage / increases system capacity.
```

Hero ability rules:

- cooldown based,
- temporary,
- usable during a wave,
- no backend request required.

Later heroes:

- Incident Commander
- Threat Hunter
- IAM Engineer
- AppSec Engineer
- AI Security Engineer

---

# 20. Bits

Bits are existing persistent platform currency.

Bits may be earned from:

- completing missions,
- completing learning activities,
- daily missions,
- achievements.

Bits may unlock:

- defense types,
- heroes,
- cosmetic skins,
- map themes,
- optional modules,
- visual effects.

Avoid:

```text
Spend 500 Bits -> WAF does +500% damage
```

Prefer horizontal progression:

```text
Unlock MFA
Unlock Backup
Unlock Threat Hunter
Unlock AI Security map
```

---

# 21. Energy

Energy must not hard-block learning.

Recommended behavior:

```text
Normal Practice:
Unlimited play

Rewarded Missions:
May consume Energy for bonus rewards
```

Alternative:

```text
Energy gives +50% Bits reward.
```

Do not force a player to stop playing because energy reached zero.

---

# 22. Learning Integration

The game should reinforce platform learning.

Possible flow:

```text
Learn concept
   ↓
Quiz
   ↓
Unlock defense
   ↓
Use defense in Cyber Defense mission
```

Examples:

```text
Learn SQL Injection
-> unlock Parameterized Queries

Learn IAM / least privilege
-> unlock Least Privilege

Learn DDoS
-> unlock Rate Limiter / DDoS Protection

Learn GenAI Security
-> unlock AI Defense controls
```

The game should still function if learning-track integration is unavailable.

---

# 23. Contextual Education

Avoid long modal tutorials.

Prefer short messages triggered by player actions.

Example invalid choice:

```text
Encryption protects data confidentiality.
It does not prevent SQL Injection.
```

Example mission failure:

```text
The WAF reduced malicious requests, but the vulnerable query remained exploitable.

Strongest fix:
Parameterized Queries
```

Keep feedback to approximately 1-3 short sentences.

---

# 24. Postmortem

After every mission, show a simple report.

Example:

```text
MISSION COMPLETE

System Health: 72%
Latency: 138 ms
Budget Remaining: 180

Blocked:
34 DDoS
8 SQL Injection
4 Credential Stuffing

Most Effective Defense:
Parameterized Queries

Architecture Note:
Your WAF helped block malicious requests, but Parameterized Queries provided the strongest SQL Injection protection.
```

On failure:

```text
SYSTEM COMPROMISED

Primary Cause:
Credential Stuffing

What happened:
The attacker obtained a valid account and reached the application.

Useful defense:
MFA

Your Rate Limiter slowed the attack but did not fully prevent account takeover.
```

Postmortem is one of the main learning features.

Keep it concise.

---

# 25. Optional Mission Rating

A simple 1-3 star result is enough.

Example:

```text
★★★
```

Possible criteria:

- system survived,
- latency stayed under target,
- spending stayed under recommended budget.

Do not implement complex grading initially.

---

# 26. Frontend Architecture

Recommended structure:

```text
src/
  game/
    engine/
      GameEngine.ts
      Simulation.ts
      CombatResolver.ts
      Pathing.ts

    models/
      attack.ts
      defense.ts
      hero.ts
      mission.ts
      map.ts

    data/
      attacks/
      defenses/
      heroes/
      missions/

    components/
      CyberDefenseGame.tsx
      GameHud.tsx
      ArchitectureMap.tsx
      DefenseShop.tsx
      DefenseCard.tsx
      WaveStatus.tsx
      HeroBar.tsx
      MissionBriefing.tsx
      MissionResult.tsx
      Postmortem.tsx

    hooks/
      useGameEngine.ts
      useMission.ts

    persistence/
      gameCache.ts
      gameProgress.ts
```

Adapt directory names to the existing repository conventions.

---

# 27. Renderer

Use the simplest rendering solution that works well with the existing frontend.

Preferred choices:

1. existing React + SVG/Canvas if sufficient,
2. Phaser if animations/pathing become cumbersome,
3. PixiJS if primarily a custom 2D renderer is needed.

Do not introduce a heavy game framework unless needed.

For the first prototype, React + SVG can be enough.

Architecture nodes and paths are especially well suited to SVG.

---

# 28. Simulation Location

Gameplay simulation must run in the browser.

No per-tick backend calls.

Do not send:

- enemy positions,
- tower attacks,
- pathfinding,
- animation state,
- wave timers

to the backend.

If performance becomes an issue later, move simulation to a Web Worker.

Do not start with Web Workers unless necessary.

---

# 29. Persistence

Use browser storage for temporary game state.

Recommended:

- IndexedDB for larger cached game content,
- localStorage only for small settings.

Examples:

```text
current unfinished mission
audio preferences
game speed
tutorial completed
cached content version
```

Persistent economy state must remain server authoritative.

---

# 30. Backend Responsibilities

Backend owns:

```text
Bits balance
permanent unlocks
purchased cosmetics
reward claims
achievement state
```

Frontend owns:

```text
active simulation
enemy movement
animations
temporary mission credits
temporary mission health
temporary hero cooldowns
```

---

# 31. Minimal API Design

Exact endpoint names may be adapted to the existing backend.

## Start Mission

```http
POST /v1/game/sessions
```

Example response:

```json
{
  "sessionId": "abc123",
  "missionId": "web-security-01",
  "seed": "8cf298",
  "bits": 840,
  "unlocks": [
    "waf",
    "rate_limiter",
    "parameterized_queries"
  ]
}
```

This endpoint may be omitted for guest/local practice.

---

## Complete Mission

```http
POST /v1/game/sessions/{sessionId}/complete
```

Example request:

```json
{
  "missionId": "web-security-01",
  "seed": "8cf298",
  "result": {
    "completed": true,
    "systemHealth": 72,
    "latencyMs": 138,
    "score": 2810,
    "durationSeconds": 313
  },
  "summary": {
    "defensesPlaced": {
      "waf": 1,
      "rate_limiter": 1,
      "parameterized_queries": 1
    },
    "attacksBlocked": {
      "ddos_swarm": 34,
      "sql_injection": 8
    }
  }
}
```

Example response:

```json
{
  "bitsAwarded": 60,
  "newBitsBalance": 900,
  "newUnlocks": []
}
```

---

# 32. Anti-Cheat

Do not overengineer anti-cheat for MVP.

Basic server checks:

- valid mission ID,
- reward not already claimed when applicable,
- maximum possible reward,
- plausible duration,
- user owns required unlocks,
- result schema valid.

Later, if abuse becomes meaningful:

- deterministic seed,
- compact player action log,
- server-side replay validation.

Do not build server-side simulation initially.

---

# 33. Data-Driven Content

Game rules should be driven by JSON/data definitions.

Do not hardcode attack-defense relationships into UI components.

Example defense:

```json
{
  "id": "parameterized_queries",
  "name": "Parameterized Queries",
  "category": "application",
  "description": "Separates SQL code from user-provided values.",
  "cost": 350,
  "latencyMs": 0,
  "allowedPlacements": [
    "application"
  ],
  "effectiveness": {
    "sql_injection": 1.0,
    "xss": 0.0,
    "ddos": 0.0,
    "credential_stuffing": 0.0
  }
}
```

Example WAF:

```json
{
  "id": "waf",
  "name": "Web Application Firewall",
  "category": "edge",
  "description": "Filters HTTP requests using security rules.",
  "cost": 250,
  "latencyMs": 4,
  "allowedPlacements": [
    "edge",
    "api"
  ],
  "effectiveness": {
    "sql_injection": 0.65,
    "xss": 0.65,
    "ddos": 0.2,
    "credential_stuffing": 0.15
  }
}
```

---

# 34. Mission Data Example

```json
{
  "id": "web-security-01",
  "title": "Protect the Storefront",
  "description": "Keep the storefront online while attackers target the API.",
  "startingBudget": 1000,
  "startingHealth": 100,
  "latencyTargetMs": 150,

  "map": {
    "nodes": [
      {
        "id": "internet",
        "type": "edge",
        "label": "Internet",
        "x": 80,
        "y": 250
      },
      {
        "id": "api",
        "type": "api",
        "label": "API",
        "x": 280,
        "y": 250
      },
      {
        "id": "app",
        "type": "application",
        "label": "Application",
        "x": 480,
        "y": 250
      },
      {
        "id": "db",
        "type": "database",
        "label": "Database",
        "x": 680,
        "y": 250
      }
    ],
    "edges": [
      {
        "from": "internet",
        "to": "api"
      },
      {
        "from": "api",
        "to": "app"
      },
      {
        "from": "app",
        "to": "db"
      }
    ]
  },

  "availableDefenses": [
    "waf",
    "rate_limiter",
    "parameterized_queries"
  ],

  "waves": [
    {
      "groups": [
        {
          "attackId": "ddos_swarm",
          "count": 10,
          "spawnIntervalMs": 450
        }
      ]
    },
    {
      "groups": [
        {
          "attackId": "sql_injection",
          "count": 6,
          "spawnIntervalMs": 800
        }
      ]
    }
  ]
}
```

---

# 35. Mobile-First / Responsive Gameplay Requirements

The game must be fully playable on mobile, and mobile must be treated as a first-class interaction model rather than a shrunken desktop layout.

## 35.1 Portrait-first requirement

Portrait mode should be fully playable.

Landscape mode may be supported, but users should not be required to rotate their device.

Recommended layout:

```text
┌─────────────────────────────┐
│ ❤️ 82   💰 420   ⚡ 118ms   │
│ Wave 3/5             ⏸  2x │
├─────────────────────────────┤
│                             │
│          INTERNET           │
│              ↓              │
│           [EDGE]            │
│              ↓              │
│           [ API ]           │
│              ↓              │
│           [ APP ]           │
│              ↓              │
│           [ DB  ]           │
│                             │
│      enemies animate        │
│      along the paths        │
│                             │
├─────────────────────────────┤
│        DEFENSES             │
│ [WAF] [Rate] [MFA] [More]  │
└─────────────────────────────┘
```

## 35.2 Responsive map orientation

Desktop layouts may use horizontal architecture flow:

```text
Internet -> Edge -> API -> App -> Database
```

Mobile layouts should usually use vertical flow:

```text
Internet
   |
   v
 Edge
   |
   v
 API
   |
   v
 App
   |
   v
Database
```

The underlying simulation graph must remain the same.

The game engine should understand logical connectivity:

```text
Internet -> Edge -> API -> App -> Database
```

The renderer decides where nodes appear on screen.

Do not store gameplay meaning in x/y coordinates.

Example:

```ts
const desktopPositions = {
  internet: { x: 100, y: 300 },
  edge:     { x: 250, y: 300 },
  api:      { x: 400, y: 300 },
  app:      { x: 550, y: 300 },
  db:       { x: 700, y: 300 }
}

const mobilePositions = {
  internet: { x: 400, y: 100 },
  edge:     { x: 400, y: 280 },
  api:      { x: 400, y: 460 },
  app:      { x: 400, y: 640 },
  db:       { x: 400, y: 820 }
}
```

Prefer deriving layout from map metadata or layout helpers rather than duplicating gameplay logic.

## 35.3 Prefer tap interactions over drag-and-drop

Do not require drag-and-drop for core gameplay.

Recommended interaction:

```text
Tap node
   ↓
Show valid defenses
   ↓
Tap defense
   ↓
Show cost / latency / effectiveness
   ↓
Deploy
```

Reason:

- drag-and-drop is less precise on phones,
- fingers can cover small placement targets,
- scrolling and dragging can conflict,
- tap interactions are easier to make accessible.

Dragging may be added later as an optional desktop interaction, but must not be required.

## 35.4 Contextual bottom sheet

On mobile, use a contextual bottom sheet instead of permanent sidebars.

Behavior:

```text
Nothing selected
→ show compact defense toolbar / mission actions

Architecture node selected
→ show defenses valid for that node

Existing defense selected
→ show upgrade / remove / info actions

Hero selected
→ show ability description and activation action
```

The sheet should not permanently consume large screen space.

Recommended expanded height:

- approximately 30% to 45% of viewport,
- collapse when not needed.

The main map must remain visible whenever practical.

## 35.5 Auto-pause or auto-slow while configuring

Opening a defense configuration panel may cover a large part of the game on mobile.

Default behavior should therefore be:

```text
Auto-pause while configuring: ON
```

Alternative:

```text
Auto-slow to 0.5x
```

If the game only supports 1x/2x initially, pause is simpler.

The user should be able to disable auto-pause later if desired.

## 35.6 Minimal mobile HUD

During combat, expose only high-value information.

Required:

```text
System Health
Budget
Latency
Wave
Pause
Game Speed
```

Avoid permanent panels showing:

- detailed tower stats,
- full attack logs,
- long descriptions,
- complete inventory,
- large mission explanation blocks.

Detailed information should appear only after tapping the relevant object.

## 35.7 Thumb-friendly placement

Frequently used controls should live in the lower half of the screen where practical.

Good candidates:

- deploy,
- upgrade,
- hero abilities,
- defense selection,
- retry,
- continue.

Less frequent actions may remain near the top:

- pause,
- speed,
- settings.

Minimum interactive target should be approximately:

```text
44 x 44 CSS pixels
```

Important actions may be larger.

Do not rely on hover.

## 35.8 Avoid mandatory zoom and panning

Normal MVP missions should fit the important architecture on one mobile screen whenever possible.

Do not require:

- pinch zoom,
- precise panning,
- navigating a very large map

for standard missions.

If larger maps are introduced later, prefer discrete zone focus.

Example:

```text
[Edge] [Application] [Data]
```

Tapping a zone can focus or expand that section.

Pinch zoom may be supported as a convenience, but should not be required to play.

## 35.9 Mobile enemy rendering

The simulation count does not need to equal the number of rendered sprites.

Example:

```text
Simulated DDoS requests: 40
Rendered attack icons: 12
```

This is acceptable when the UI clearly communicates that a swarm represents many requests.

Use rendering caps to improve:

- readability,
- frame rate,
- battery use,
- low-end device performance.

The simulation result must remain independent from the number of rendered icons.

## 35.10 Mobile mission duration

Favor short sessions.

Recommended normal mobile mission length:

```text
3 to 6 minutes
```

Boss missions may be longer.

Daily missions should usually be short enough to complete in approximately 3 to 5 minutes.

## 35.11 Mobile defense cards

Keep cards compact and scannable.

Example:

```text
┌─────────────────────────┐
│ WAF                     │
│                         │
│ SQL Injection  ★★★★☆    │
│ XSS            ★★★★☆    │
│ DDoS           ★☆☆☆☆    │
│                         │
│ Cost: 250   +4 ms       │
│                         │
│       [ Deploy ]        │
└─────────────────────────┘
```

Do not show too many raw numerical statistics.

Prefer:

- short descriptions,
- simple strength indicators,
- cost,
- latency,
- placement restrictions.

## 35.12 Mobile renderer recommendation

For the first implementation, prefer:

```text
React
  |
  +-- SVG architecture map
  |     +-- nodes
  |     +-- paths
  |     +-- defense positions
  |     +-- attack movement
  |
  +-- React HUD
  |
  +-- contextual bottom sheet
```

SVG is a strong fit because:

- architecture diagrams are node/path based,
- it scales well through `viewBox`,
- desktop and mobile layouts can share the same logical graph,
- pointer/tap targets are straightforward,
- animation complexity is moderate.

Example:

```tsx
<svg
  viewBox="0 0 800 1000"
  preserveAspectRatio="xMidYMid meet"
>
```

Only introduce Phaser/PixiJS if SVG becomes a meaningful limitation.

## 35.13 Mobile-friendly defaults

Recommended defaults:

```text
Game speed: 1x
Auto-pause while configuring: ON
Large readable text: ON
Reduced information density: ON
Sound feedback: ON
Haptics: Optional
```

Respect global platform settings where they already exist.

## 35.14 Mobile acceptance criteria

Mobile support is complete only if:

- portrait mode is fully playable,
- the core map does not require horizontal scrolling,
- desktop horizontal maps can become mobile vertical maps,
- tapping replaces required drag-and-drop,
- node selection opens only relevant defenses,
- contextual panels do not permanently hide the map,
- configuration can auto-pause gameplay,
- no hover-only interaction exists,
- important controls meet touch target sizing,
- the normal map is playable without pinch zoom,
- the HUD remains readable on small screens,
- rendered enemy count can be capped without changing simulation results,
- the game remains usable on typical phone widths,
- mission completion and postmortem screens fit mobile without dense tables.

Core principle:

> Do not make the player operate a tiny desktop tower-defense board.

Mobile should feel like interacting with a responsive security architecture diagram:
tap a system node, choose a defense, deploy it, watch the attack, respond, and learn from the outcome.


# 36. Accessibility

Support:

- reduced-motion preference,
- sound on/off,
- keyboard interaction where practical,
- clear text labels instead of color-only status,
- readable font sizes,
- pause button,
- game speed control.

Recommended speed:

```text
1x
2x
```

Optional later:

```text
0.5x
```

---

# 37. ADHD-Friendly Behavior

The game should reduce friction.

Use:

- short missions,
- obvious next action,
- limited tower choices per mission,
- immediate visual feedback,
- easy retry,
- no punishment for experimentation,
- restart from mission rather than losing permanent resources,
- concise explanations,
- visible progress through waves.

Avoid:

- huge defense menus,
- long tutorials,
- five nested configuration screens,
- excessive text before gameplay,
- forcing a full restart after every mistake.

---

# 38. UI Screens

MVP requires:

## 38.1 Game Home / Entry

Shows:

```text
Cyber Defense
Protect systems from real cyber attacks.

[Play]
```

Optional:

```text
Daily Mission
```

The home/mission-select page is public so signed-out visitors can see what the
game is. **Playing a mission requires an account**: the mission route is guarded
and sends a signed-out visitor to sign in (returning them to the mission after).
The economy is already account-scoped, so anonymous play would have no wallet.

---

## 38.2 Mission Select

Initially only a few missions.

Example:

```text
1. DDoS Basics
2. SQL Injection
3. Identity Attack
4. Mixed Defense
5. Boss: Botnet
```

Locked missions can show their unlock requirement.

---

## 38.3 Mission Briefing

Example:

```text
PROTECT THE STOREFRONT

Threats:
DDoS
SQL Injection

Budget:
1,000

Latency Target:
< 150 ms

[Start]
```

---

## 38.4 Main Game

Must display:

```text
System Health
Budget
Latency
Wave number
Architecture
Defense controls
Hero ability
Pause
Game speed
```

---

## 38.5 Result / Postmortem

Display:

```text
Completed / Failed
Stars
Health remaining
Latency
Bits earned
Most effective defense
1 short architecture lesson
Retry
Continue
```

---

# 39. Sound / Visual Feedback

Use small effects.

Examples:

- blocked attack,
- defense activated,
- wave complete,
- boss appears,
- system takes damage,
- mission complete.

Do not make effects visually overwhelming.

A cleared Cyber Defense mission plays a short fanfare (a bigger one for a
perfect clear or a defeated boss) and shows a one-shot victory burst on the
result screen: a confetti shower, expanding shockwave rings, and a spark burst.
The burst is decorative, hidden from assistive tech, and is removed entirely
when reduced motion or reward animations are off, leaving the static result
unchanged.

If the platform already has global sound settings, reuse them.

---

# 40. Recommended MVP Missions

Implement a small vertical slice first.

## Mission 1: DDoS Basics

Available defenses:

- Rate Limiter
- DDoS Protection

Purpose:

- teach edge defense,
- teach budget.

---

## Mission 2: SQL Injection

Available defenses:

- WAF
- Parameterized Queries

Purpose:

- WAF reduces risk,
- Parameterized Queries are the stronger root fix.

---

## Mission 3: Credential Stuffing

Available defenses:

- Rate Limiter
- MFA

Purpose:

- defense-in-depth.

---

## Mission 4: Mixed Attack

Attacks:

- DDoS
- SQL Injection
- Credential Stuffing

Purpose:

- choose appropriate defenses,
- manage budget and latency.

---

## Mission 5: Botnet Boss

Purpose:

- combine prior concepts,
- use hero ability,
- final MVP challenge.

---

# 41. AI Security Expansion

Do not make this part of the first vertical slice unless existing architecture makes it trivial.

Later add:

```text
User -> API -> LLM -> Agent -> Tool
               |
               -> RAG
```

Attack:

```text
Prompt Injection
```

Possible defenses:

```text
Tool Permission Boundary
Input Isolation
Human Approval
Output Validation
RAG Source Validation
```

Important design rule:

No single "Prompt Injection Firewall" should guarantee safety.

The gameplay should emphasize limiting what an AI agent is allowed to do.

---

# 42. Implementation Phases

## Phase 1 - Playable Prototype

Goal:

Prove the game is fun and understandable.

Implement:

- one architecture map,
- DDoS enemy,
- SQL Injection enemy,
- Rate Limiter,
- WAF,
- Parameterized Queries,
- health,
- budget,
- waves,
- basic attack movement,
- placement,
- win/fail screen.

No backend required.

Use static local data.

---

## Phase 2 - MVP Game

Add:

- 4-5 missions,
- Credential Stuffing,
- MFA,
- latency,
- tower upgrades,
- simple synergies,
- one boss,
- one or two heroes,
- mission result/postmortem,
- mobile UI,
- local persistence.

---

## Phase 3 - Platform Integration

Add:

- Bits rewards,
- unlocks,
- learning-track integration,
- API mission completion,
- daily mission support,
- achievements,
- server-authoritative economy.

---

## Phase 4 - Expansion

Possible additions:

- AI Security maps,
- ransomware,
- backup/recovery,
- detection towers,
- hidden attacks,
- additional heroes,
- AWS-specific controls,
- Terraform/IaC integration,
- cosmetic rewards.

Do not implement Phase 4 until usage data shows the core game is valuable.

---

# 43. MVP Acceptance Criteria

The MVP is successful when all of the following are true:

- A user can start a mission without reading a long tutorial.
- A user can understand where attacks are moving.
- A user can place defenses on architecture nodes.
- Invalid defense placement is prevented.
- Different attack types respond differently to defenses.
- WAF and Parameterized Queries behave differently against SQL Injection.
- Rate Limiter and MFA behave differently against Credential Stuffing.
- Budget affects player decisions.
- Latency changes when defenses are added.
- The mission can be won or lost.
- The player receives a concise postmortem.
- Gameplay works without continuous API access.
- Mission simulation runs in browser.
- Temporary game state survives accidental page refresh when practical.
- Mobile gameplay is usable.
- Bits cannot be permanently modified only from client state.
- Game content is data-driven rather than hardcoded in UI.
- A new attack or defense can be added primarily by adding a data definition.
- Core gameplay works even if recommendation/adaptive APIs fail.

---

# 44. Explicit Non-Goals for MVP

Do not implement these unless requested later:

- multiplayer,
- PvP,
- global economy simulation,
- realistic cloud billing engine,
- complete MITRE ATT&CK simulation,
- realistic packet simulation,
- complex network routing,
- full SIEM simulation,
- detailed compliance frameworks,
- user-created architecture editor,
- procedural architecture generation,
- LLM required during gameplay,
- server-authoritative real-time game loop,
- WebSockets for normal missions,
- elaborate anti-cheat,
- blockchain/NFT economy,
- dozens of tower stats,
- dozens of upgrade levels,
- complex crafting system,
- pay-to-win Bit upgrades.

---

# 45. Important Product Constraint

When choosing between:

```text
more realistic
```

and:

```text
easier to understand + still teaches the correct main idea
```

prefer the second.

The game should teach useful mental models without turning into cybersecurity training software for professional SOC analysts.

---

# 46. AI Coding Agent Instructions

When implementing this feature:

1. Inspect the existing repository structure before adding new architecture.
2. Reuse existing:
   - UI components,
   - design tokens,
   - responsive patterns,
   - auth state,
   - Bits state,
   - sound settings,
   - API client,
   - content caching/versioning.
3. Do not rewrite unrelated platform systems.
4. Build the game engine as isolated, testable logic.
5. Keep rendering separate from simulation state.
6. Prefer pure functions for attack-defense calculations.
7. Make content data-driven.
8. Add unit tests for:
   - effectiveness calculations,
   - placement rules,
   - budget spending,
   - latency totals,
   - mission completion,
   - reward summary generation.
9. Keep the MVP implementation small.
10. Do not implement future features merely because this document mentions them.
11. Treat sections labeled "Later", "Expansion", or "Possible" as out of scope unless explicitly requested.
12. Preserve graceful fallback behavior if backend APIs fail.
13. Do not use an LLM/API call for enemy behavior.
14. Avoid unnecessary API requests during gameplay.
15. Confirm mobile usability before considering the feature complete.

---

# 47. First Implementation Task

Start with the smallest complete vertical slice:

```text
Mission:
Protect the Storefront

Map:
Internet -> API -> Application -> Database

Attacks:
DDoS
SQL Injection

Defenses:
Rate Limiter
WAF
Parameterized Queries

Mechanics:
Health
Budget
Placement
Waves
Win/Lose
Short Postmortem
```

Do not implement Bits, heroes, energy, bosses, AI security, or backend persistence until this vertical slice is playable.

The first milestone should answer only one question:

> Is placing real security controls on an architecture map to stop cyber attacks understandable and fun?

If the answer is yes, proceed to the later phases.
