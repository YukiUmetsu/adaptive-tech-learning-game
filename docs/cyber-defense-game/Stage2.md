# Cyber Defense Tower — Stage 2 Implementation Plan

**File:** `Stage2.md`  
**Stage:** 2  
**Stage 1 baseline:** existing `cyber-td` implementation  
**Primary product goal:** turn the existing Cyber Defense Tower game from a five-mission experience into a persistent, replayable game that a user can casually return to for months.

---

## 1. Priority Order

When requirements conflict, use this order:

1. **Fun**
2. **A game system that remains worth playing for months**
3. **Meaningful use of Bits**
4. **Security education**

Security content must still be reasonably accurate. "Security education is fourth priority" means the game should not sacrifice fun or replayability to become a simulator or textbook. It does **not** mean knowingly teaching false security concepts.

### Stage 2 product test

A successful Stage 2 player should be able to finish the original five missions and still think:

> "I want to play one more operation because I am close to a hero level, a Tower upgrade, or the next adversary/story reveal."

The game must no longer end after the original five missions.

---

# 2. Stage 1 Baseline — Do Not Rebuild Existing Systems

Before implementing Stage 2, inspect the current `cyber-td` branch and preserve the working Stage 1 systems.

Stage 1 already includes:

- Five missions:
  - DDoS basics
  - SQL Injection
  - Credential Stuffing
  - Mixed Defense
  - Botnet DDoS boss
- Browser-side deterministic simulation.
- Multiple waves and intermissions.
- Mission-local credits.
- Early-wave call bonus.
- System health.
- Latency target.
- Star ratings.
- Mission postmortems.
- Mission resume/cache.
- Build pads and placement rules.
- Eleven security defenses/controls.
- Defense-specific effectiveness.
- Support controls.
- Defense-in-depth synergies.
- Rate Limiter gate behavior.
- Hidden/revealed attacks.
- Backup recovery.
- Boss health and boss summons.
- Two playable heroes:
  - Security Engineer
  - SRE
- Heroes can be deployed on the road.
- Hero melee combat.
- Hero active duration.
- Hero cooldowns.
- Hero aura effects.
- Sound, feedback, effects, pausing, speed controls, and mobile-oriented interactions.
- Existing Bits wallet infrastructure.
- Local mission completion/stars/best-health/attempt tracking.
- Current server endpoint for spending Bits on an in-run defense upgrade.

Useful Stage 1 code locations include:

```text
apps/web/src/game/
  components/
  data/
    attacks.ts
    defenses.ts
    heroes.ts
    missions.ts
    synergies.ts
  engine/
    combat.ts
    simulation.ts
    postmortem.ts
  hooks/
  models/
  persistence/

apps/web/src/pages/
  CyberDefensePage.tsx
  CyberDefenseMissionPage.tsx

apps/api/src/routes/cyber_defense.rs
apps/api/src/services.rs

apps/web/src/state/
  wallet.ts
  bitSpends.ts

crates/db/migrations/

docs/18-cyber-defense-game-spec.md
```

Stage 2 should extend these systems rather than replacing them.

---

# 3. Research Summary and Design Implications

This section summarizes the research basis for Stage 2. The coding agent does not need to reproduce the research. It should use the implications when making implementation decisions.

## 3.1 Player motivation: autonomy, competence, relatedness

Self-Determination Theory research applied to games found that perceived **autonomy**, **competence**, and **relatedness** are associated with enjoyment and future play. In particular, autonomy and competence matter strongly for a single-player strategy game.

### Stage 2 implications

Support autonomy through:

- hero choice,
- Tower/HQ upgrade choices,
- selectable challenge,
- multiple viable defense strategies,
- optional story/detail screens instead of forced long exposition.

Support competence through:

- clear progression,
- readable cause-and-effect,
- hero levels,
- visible Tower growth,
- understandable losses,
- mastery of increasingly difficult operations.

Support relatedness primarily through the fictional organization, operators, and recurring adversaries. Stage 2 does **not** need multiplayer or social mechanics.

Source:

- Ryan, Rigby, Przybylski, *The Motivational Pull of Video Games: A Self-Determination Theory Approach*  
  https://selfdeterminationtheory.org/SDT/documents/2006_RyanRigbyPrzybylski_MandE.pdf

---

## 3.2 Challenge should grow with player ability

Research on game-based learning and flow indicates that challenge and engagement are related, and that challenge should keep pace with growing player ability. Dynamic difficulty research does **not** establish one universally best adaptation strategy.

### Stage 2 implication

Do **not** secretly manipulate difficulty to force wins or losses.

Implement:

- a visible **Recommended Threat Level**,
- user-selectable threat level,
- performance-based recommendations,
- optional harder operations,
- deterministic and explainable scaling.

The user can always choose a lower or higher level than recommended.

This protects autonomy while reducing boredom and frustration.

Sources:

- Hamari et al., *Challenging games help students learn*  
  https://doi.org/10.1016/j.chb.2015.07.045
- Ang & Mitchell, *Comparing Effects of Dynamic Difficulty Adjustment Systems on Video Game Experience*  
  https://doi.org/10.1145/3116595.3116623
- *Dynamic Difficulty Adjustment in Tower Defence*  
  https://doi.org/10.1016/j.procs.2015.07.563

---

## 3.3 Long-term progression needs more than points

Gamification research generally finds positive but modest effects. Points and badges by themselves are not enough to make a long-lived game. Levels, autonomy, feedback, and meaningful game choices matter.

### Stage 2 implication

Bits must buy something the player cares about.

Do not treat:

```text
Bits balance increased
```

as the reward.

Instead make Bits enable visible permanent progress such as:

```text
Tower floor upgraded
Threat Intel room improved
Hero training capability unlocked
New strategic option unlocked
```

The reward loop should be:

```text
Play
  ↓
Earn Bits / XP
  ↓
Make a permanent choice
  ↓
See the Tower / hero / dossier change
  ↓
Have new strategic possibilities
  ↓
Play again
```

Sources:

- *Gamification enhances student intrinsic motivation...: a meta-analysis*  
  https://link.springer.com/article/10.1007/s11423-023-10337-7
- *Using game concepts to improve programming learning: A multi-level meta-analysis*  
  https://onlinelibrary.wiley.com/doi/10.1002/cae.22630

---

## 3.4 Avoid dark-pattern retention

Long-term play must come from mastery, progression, strategy, story, and ownership.

Do **not** use Stage 2 to add:

- loot boxes,
- paid random rewards,
- deliberately frustrating wait timers,
- expiring rewards,
- daily FOMO,
- streak-loss punishment,
- forced check-ins,
- artificial energy limits,
- deceptive near-miss systems.

There are no daily incidents in Stage 2.

Source:

- 2026 systematic review of dark patterns and random reward mechanisms in games  
  https://www.sciencedirect.com/science/article/pii/S1875952126000443

---

## 3.5 Game theory and strategic balance

A strategy game becomes shallow when one choice is effectively dominant.

The player should repeatedly face trade-offs such as:

```text
Spend now vs save
Broad defense vs specialist defense
More protection vs lower latency
Information vs direct mitigation
Hero A vs Hero B
Safe threat level vs harder reward
```

### Stage 2 implication

No single defense, hero, Tower build, or upgrade path should be correct in nearly every operation.

Operations must be context-dependent.

Measure defense and hero selection rates after release. Investigate designs where one option dominates unrelated operation types.

Player decisions should generally satisfy this pattern:

```text
Choice A has a meaningful advantage.
Choice B has a different meaningful advantage.
The better choice depends on the operation state.
```

Risk/reward should remain readable. The existing early-wave-call mechanic is a good example and should stay.

Useful research/background:

- Player tactics in commercial tower defense games:  
  https://www.sciencedirect.com/science/article/pii/S1875952125000436
- Risk/reward decision making under uncertainty:  
  https://pubmed.ncbi.nlm.nih.gov/29567432/
- Avoiding dominant options is a core balance objective. A recent formal treatment of asymmetric game balance is available here:  
  https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7001878

---

## 3.6 UI/UX: keep state visible and choices understandable

General usability research strongly supports:

- visibility of system status,
- consistency,
- user control,
- error prevention,
- recognition instead of recall,
- progressive disclosure.

### Stage 2 implication

The game dashboard must immediately answer:

```text
What should I do next?
How strong am I?
What am I working toward?
How many Bits do I have?
Who am I fighting?
What will I unlock next?
```

Do not put every meta-system on the main screen at once.

Use one primary action:

```text
CONTINUE DEFENSE
```

Secondary destinations can be:

```text
Tower
Heroes
Threat Intel
Campaign
Operations
```

Source:

- Nielsen Norman Group, usability heuristics  
  https://www.nngroup.com/articles/ten-usability-heuristics/

Accessibility guidance:

- allow pause,
- avoid essential information that disappears too quickly,
- support reduced motion,
- do not use color alone for state,
- use readable text and touch-friendly controls.

Example game accessibility guidance:

- Microsoft Xbox Accessibility Guidelines  
  https://learn.microsoft.com/en-us/gaming/accessibility/

---

# 4. Cybersecurity Research Basis

Stage 2 is a game first, but the security relationships used in game mechanics must remain defensible.

Use the following as primary references when adding or changing security content.

## 4.1 High-level defensive structure

NIST CSF 2.0 organizes cybersecurity outcomes around:

```text
Govern
Identify
Protect
Detect
Respond
Recover
```

This is useful conceptual inspiration for the Tower/HQ without turning the game into compliance training.

Source:

- NIST Cybersecurity Framework 2.0  
  https://www.nist.gov/publications/nist-cybersecurity-framework-csf-20

CIS Controls provide a prioritized set of safeguards and emphasize building an adaptive, continuously improved defense.

Sources:

- https://www.cisecurity.org/controls
- https://www.cisecurity.org/controls/implementation-groups

---

## 4.2 Adversaries and TTPs

Use MITRE ATT&CK vocabulary carefully.

ATT&CK:

- **Tactics** represent the adversary's goal/why.
- **Techniques** represent how an adversary accomplishes a tactical goal.

Useful Enterprise tactics include:

```text
Reconnaissance
Initial Access
Execution
Persistence
Privilege Escalation
Credential Access
Discovery
Lateral Movement
Collection
Command and Control
Exfiltration
Impact
```

The Stage 2 adversary system may borrow these concepts for story, dossiers, and operation modifiers.

Do not falsely label every web vulnerability as an ATT&CK technique.

Sources:

- https://attack.mitre.org/tactics/
- https://attack.mitre.org/techniques/

---

## 4.3 Web security relationships

### SQL Injection

Keep the current concept that Parameterized Queries are substantially stronger/root-cause protection compared with merely filtering traffic through a WAF.

OWASP's preferred SQL injection defenses include prepared statements / parameterized queries.

Source:

- https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html

### XSS

Do not teach that CSP alone "solves XSS."

Output encoding, safe framework behavior, sanitization where appropriate, and other contextual defenses matter. CSP is defense in depth.

Source:

- https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

### Credential stuffing

MFA is a strong defense against password reuse attacks. Rate limiting is useful but should not be presented as equivalent to strong authentication.

Phishing-resistant MFA is stronger than generic push/SMS MFA.

Sources:

- https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html
- https://www.cisa.gov/audiences/small-and-medium-businesses/secure-your-business/require-multifactor-authentication

### Current web-risk taxonomy

Use OWASP Top 10:2025 when future Stage 2 content references modern web risk categories.

Source:

- https://top10.owasp.org/2025/

---

## 4.4 Networking and system security relationships

### Segmentation

Network segmentation can limit lateral movement and contain compromise. It is not a magic prevention control.

Sources:

- CISA ransomware guidance  
  https://www.cisa.gov/stopransomware/ransomware-guide
- CISA network segmentation guidance  
  https://www.cisa.gov/sites/default/files/publications/layering-network-security-segmentation_infographic_508_0.pdf

### Least privilege

Least privilege should primarily reduce blast radius/impact. It should not behave like a generic projectile tower that magically blocks unrelated attacks.

### Backups

Backup is primarily recovery/resilience. It should not be represented as preventing ransomware infection.

### Monitoring / IDS

Monitoring and detection should reveal, provide warning, or improve response. Avoid describing logging/IDS as automatically preventing all attacks.

### Zero Trust

Zero Trust is not "trust nothing" and is not simply network segmentation. NIST emphasizes protecting resources and avoiding implicit trust based solely on network location.

Source:

- NIST SP 800-207  
  https://csrc.nist.gov/pubs/sp/800/207/final

### Incident response

Respond and Recover should remain part of the fiction and postmortem systems rather than forcing the tower-defense game into a detailed SOC simulator.

Source:

- NIST SP 800-61 Rev. 3  
  https://csrc.nist.gov/pubs/sp/800/61/r3/final

---

# 5. Stage 2 Design Pillars

## 5.1 Keep Tower Defense as the main game

Stage 2 is **not** a request to create several new mini-games.

The existing tower-defense simulation remains the primary gameplay.

New systems should feed into it:

```text
Persistent progression
        ↓
Operation selection
        ↓
Existing Tower Defense gameplay
        ↓
Rewards
        ↓
Tower / Hero / Adversary / Story progression
        ↓
Next operation
```

---

## 5.2 Preserve the original five missions

The current five Stage 1 missions become the introductory campaign.

Conceptually:

```text
CHAPTER 1 — FIRST CONTACT

1. DDoS Basics
2. SQL Injection
3. Credential Stuffing
4. Mixed Defense
5. Botnet DDoS Boss
```

The exact existing names may remain if changing them would add unnecessary work.

Completing Mission 5 should now communicate:

```text
CHAPTER 1 COMPLETE
OPERATIONS UNLOCKED
```

It must **not** communicate that the player has effectively finished the whole Cyber Defense game.

---

## 5.3 No daily system in Stage 2

Explicit non-goals:

- no daily incidents,
- no daily missions,
- no daily login reward,
- no mandatory daily check-in,
- no streak-loss punishment,
- no time-gated content.

A user should be able to play:

- three times in one evening,
- once per week,
- or return after three weeks,

without being punished.

---

# 6. Core Stage 2 Loop

The target long-term loop:

```text
                 ┌─────────────────────┐
                 │   CONTINUE DEFENSE  │
                 └──────────┬──────────┘
                            ↓
                    Select / accept
                       Operation
                            ↓
                   Tower Defense Run
                            ↓
       ┌────────────────────┼────────────────────┐
       ↓                    ↓                    ↓
     Bits                  XP               Adversary Intel
       ↓                    ↓                    ↓
 Tower / HQ            Hero + Officer        Dossier /
 Upgrades                Progression          Story
       └────────────────────┼────────────────────┘
                            ↓
                  New strategic options
                            ↓
                Higher Threat Operations
                            ↓
                    Continue Defense
```

The loop must work without new attack types being required every week.

---

# 7. Stage 2 Feature Scope

The required Stage 2 systems are:

1. **Persistent Cyber Defense profile**
2. **Real Cyber Defense reward settlement**
3. **Mission-credit in-run upgrades**
4. **Hero levels and hero progression**
5. **Persistent Tower / Cyber Defense HQ**
6. **Repeatable Operations**
7. **Recurring fictional adversaries with progression**
8. **Story progression**
9. **Threat Intel / adversary dossier**
10. **Visible recommended difficulty**
11. **Cross-device/server-side persistent progression**
12. **Balance telemetry**

The following are explicitly not required for Stage 2:

- new game genres,
- PvP,
- multiplayer,
- guilds,
- leaderboards,
- daily missions/incidents,
- seasons,
- battle passes,
- loot boxes,
- gacha,
- paid Bits,
- energy systems,
- real-time backend simulation,
- complex SOC workflow simulation.

---

# 8. Persistent Cyber Defense Profile

Create a server-authoritative Cyber Defense profile.

Recommended conceptual model:

```ts
interface CyberDefenseProfile {
  playerLevel: number
  playerXp: number
  rank: string

  towerLevel: number

  totalOperationsCompleted: number
  highestThreatLevelCleared: number
  recommendedThreatLevel: number

  activeStoryChapter: string
  storyFlags: string[]

  heroes: HeroProgress[]
  towerUpgrades: TowerUpgradeProgress[]
  adversaries: AdversaryProgress[]
}
```

Do not trust the browser to directly set:

```text
XP
level
Bits
Tower upgrade levels
adversary rank
story completion
reward amounts
```

The server calculates transitions.

---

# 9. Officer / Career Level

Add an overall Cyber Defense career level.

This is separate from individual hero levels.

Example ranks:

```text
Level 1–4     Junior Security Analyst
Level 5–9     Security Analyst
Level 10–14   Senior Security Analyst
Level 15–19   Incident Responder
Level 20–24   Threat Hunter
Level 25+     SOC Lead
```

Names and thresholds should be data-driven.

## Requirements

- Career XP is earned from Operations and first-time campaign clears.
- Failed Operations should award a smaller amount of XP so an unsuccessful session is not completely wasted.
- XP requirements increase gradually.
- Early levels should arrive quickly.
- Progression should slow later without becoming grindy.
- Career level may unlock:
  - higher recommended threat levels,
  - Tower rooms,
  - story chapters,
  - optional Operation modifiers.

Career level should **not** simply provide large universal damage bonuses.

---

# 10. Hero Progression

Stage 1 already has two actual combat heroes. Keep them.

```text
Security Engineer
SRE
```

Stage 2 adds persistent progression around them.

## 10.1 Hero level

Recommended Stage 2 cap:

```text
Level 20
```

The cap must be configurable so a later stage can extend it without schema changes.

## 10.2 XP rules

Hero XP is awarded to the hero selected/used for the Operation.

Avoid XP systems that encourage pointless ability spam.

Recommended:

```text
Operation completed:
  full hero XP

Operation failed:
  partial hero XP

Hero deployed at least once:
  small participation bonus
```

Do not calculate XP from raw melee-hit count.

## 10.3 Milestone talents

Do not make every level a meaningless `+2% damage`.

Most levels can slightly improve the hero, but milestone levels should change play.

Example milestones:

```text
Level 5
Level 10
Level 15
Level 20
```

Each milestone may offer one of two choices.

Example Security Engineer direction:

```text
Rapid Response
- shorter cooldown

Deep Hardening
- stronger control-effectiveness aura
```

Example SRE direction:

```text
Burst Capacity
- stronger mitigation for a shorter duration

Sustained Capacity
- longer duration with lower peak mitigation
```

Exact values must be balance-tested.

### Talent UX

- Show only the next meaningful milestone by default.
- Allow the player to inspect the full path.
- Do not permanently punish an early choice.
- Respec should be free or inexpensive enough that experimentation is encouraged.
- Do not use randomized talents.

---

# 11. Persistent Tower / Cyber Defense HQ

The Tower is the major persistent visual progression system and the primary Bits sink.

It should feel like:

> "This is my cyber defense organization and it has grown because I kept playing."

## 11.1 Visual requirement

Create a dedicated Tower/HQ screen.

A simple 2D/SVG/CSS building is sufficient.

The visual should change when rooms/floors are upgraded.

Do not require 3D.

Example:

```text
┌───────────────────────────┐
│ Threat Intelligence  Lv 2 │
├───────────────────────────┤
│ Training Center      Lv 3 │
├───────────────────────────┤
│ Engineering Lab      Lv 2 │
├───────────────────────────┤
│ SOC                  Lv 4 │
└───────────────────────────┘
```

## 11.2 Initial Stage 2 rooms

Keep the number small.

Recommended:

### SOC

Purpose:

- operation awareness,
- wave preview,
- detection assistance.

Possible upgrades:

- reveal the first wave before deployment,
- later reveal two upcoming waves,
- improve explanation of hidden threats.

### Threat Intelligence

Purpose:

- adversary information,
- operation modifier previews,
- dossier progression.

Possible upgrades:

- reveal adversary specialty,
- reveal one hidden modifier,
- reveal boss warning,
- expose more pre-mission threat information.

### Training Center

Purpose:

- hero progression.

Possible upgrades:

- unlock hero talent milestones,
- modest hero XP bonus,
- unlock alternate hero loadout capability later.

### Engineering Lab

Purpose:

- strategic defense customization.

Stage 2 may initially use this for:

- unlocking optional defense variants,
- loadout flexibility,
- one additional strategic upgrade slot.

Do not immediately add a large tech tree.

### Resilience Center

Purpose:

- response/recovery.

Possible upgrades:

- small improvements to recovery-oriented mechanics,
- better postmortem information,
- optional emergency capability at higher level.

Avoid turning it into an automatic-win button.

## 11.3 Tower level

Tower level should be derived from permanent facility progress rather than being an unrelated XP bar.

Example:

```text
Tower Level = function(sum of room levels, major story milestones)
```

This gives the building a meaningful aggregate level.

---

# 12. Bits Economy — Major Stage 2 Change

Bits become persistent meta-progression currency.

## 12.1 Remove persistent Bits from temporary in-run upgrades

Current Stage 1 behavior spends persistent Bits to upgrade a deployed control for the current mission.

Stage 2 should change this.

Use:

```text
Mission Credits
→ place defenses
→ upgrade defenses during the run

Bits
→ permanent Tower/HQ progression
→ other permanent meta unlocks
```

This separation is important.

A player should not permanently lose platform currency for a tower that disappears at the end of a five-minute run.

## 12.2 Real Cyber Defense rewards

Stage 1 currently previews Bits at the result screen.

Stage 2 must settle actual Cyber Defense rewards server-side.

Reward categories:

```text
Operation completion Bits
Star/performance bonus
Higher-threat bonus
First-time campaign clear bonus
Boss/story milestone bonus
```

Failed runs may award a small amount of XP but normally little or no Bits. Tune this through playtesting.

## 12.3 Reward principles

- The server calculates reward amount.
- A run can settle its reward only once.
- Replaying the same completed run ID never awards again.
- Higher threat level should generally pay more.
- Playing below the player's recommended level remains allowed but should be an inefficient farming strategy.
- There must be no requirement to spend money.
- There is no paid Bits purchase in Stage 2.
- There is no random Bits jackpot.

## 12.4 Upgrade pacing target

Exact numbers must be centralized in configuration and playtested.

Target feeling:

```text
Early game:
meaningful permanent purchase every ~1–2 casual sessions

Mid game:
meaningful purchase every ~2–4 sessions

Late Stage 2:
larger upgrade every ~3–6 sessions
```

Avoid both:

```text
"I can buy everything immediately."
```

and:

```text
"I need to replay the same thing 30 times for one upgrade."
```

---

# 13. Repeatable Operations — Main Replayability System

After the original five missions, unlock **Operations**.

Operations are unlimited. They are not daily.

The player can play as many or as few as desired.

## 13.1 Semi-procedural, not fully random

Do not generate arbitrary combinations that may be impossible, nonsensical, or educationally wrong.

Build Operations from curated templates.

An operation template defines:

```ts
interface OperationTemplate {
  id: string
  mapId: string

  allowedAttackTypes: AttackType[]
  requiredCoverage: string[]

  baseBudget: number
  baseHealth: number
  baseLatencyTargetMs: number

  waveRules: WaveGenerationRules
  allowedModifiers: string[]

  compatibleAdversaries: string[]
}
```

A seed determines variation inside those safe rules.

## 13.2 Operation variation

Reuse the current systems by varying:

- enemy composition,
- counts,
- spawn interval,
- wave count,
- boss presence,
- hidden attacks,
- budget,
- latency target,
- enemy speed,
- enemy attack effort/health,
- target path,
- defense availability,
- one or more clearly disclosed modifiers.

Do not scale every variable simultaneously.

Players should understand why an Operation is harder.

## 13.3 Seeded generation

Every Operation receives a deterministic seed.

Benefits:

- reproducibility,
- debugging,
- analytics,
- possible future replay validation,
- the same Operation can be resumed.

## 13.4 Operation length

Target:

```text
5–12 minutes for normal Operations
10–18 minutes for major/boss Operations
```

A user should be able to make visible progress in a short casual session.

## 13.5 Operation selection UX

Do not dump 20 Operations on the player.

Default screen:

```text
RECOMMENDED OPERATION

Threat Level 6
GHOST-7
Credential pressure + hidden traffic
Estimated time: 8 min

[CONTINUE DEFENSE]
```

Optional:

```text
Browse Other Operations
```

A browse screen may show two or three alternates.

This preserves autonomy without creating choice paralysis.

---

# 14. Threat Level and Difficulty

Use a visible numeric threat system.

Example:

```text
Threat Level 1–10
```

The architecture should allow future extension beyond 10.

## 14.1 Recommended Threat Level

Calculate a recommendation using recent performance, for example:

- clears,
- remaining health,
- stars,
- repeated failures,
- current career level.

Do not silently alter an Operation after the user starts it.

Display:

```text
Recommended: Threat Level 5
```

The player can select:

```text
4
5
6
```

or browse a wider range from an advanced control.

## 14.2 Difficulty scaling

Preferred order of scaling:

1. smarter composition / mixed threats,
2. additional waves,
3. meaningful modifiers,
4. slightly tighter budget/latency,
5. moderate enemy-stat scaling.

Avoid relying primarily on enormous HP inflation.

---

# 15. Recurring Adversaries

Stage 2 adds recurring fictional adversaries.

They exist to:

- give attacks personality,
- provide long-term progression,
- create strategic themes,
- carry the story,
- make repeated Operations feel connected.

They are not real threat groups.

## Naming constraint

Do not name a character **Oracle**.

Avoid names that intentionally mimic real cybersecurity vendors, major database/cloud companies, or real threat groups.

## 15.1 Initial adversaries

Recommended initial set:

### GHOST-7

Theme:

- identity,
- credential attacks,
- stealth,
- account compromise.

Favors:

- Credential Stuffing,
- hidden threats,
- authentication pressure.

### NULL

Theme:

- web/application attacks.

Favors:

- SQL Injection,
- XSS,
- application-layer combinations.

### VIPER

Theme:

- malware/impact/recovery pressure.

Favors:

- Ransomware,
- high-impact attacks,
- resilience and blast-radius decisions.

Names and descriptions remain content-data, not engine constants.

## 15.2 Adversary progression model

Do not make adversary level simply mean:

```text
+10% HP every time player wins
```

Separate:

```text
Adversary Rank
```

from:

```text
Operation Threat Level
```

### Adversary Rank

Represents:

- story progression,
- learned tactics,
- dossier completion,
- expanded modifier pool.

Example:

```text
Rank 1
Known: Credential Stuffing

Rank 3
New tactic unlocked

Rank 5
New mixed-operation behavior

Rank 7
Boss operation

Rank 10
Major story reveal
```

### Threat Level

Controls numeric challenge.

This separation prevents the game from punishing the player merely for progressing the story.

## 15.3 Adversary progression fairness

- Adversary rank never forces the player into an unwinnable threat level.
- The player can lower Threat Level.
- New tactics must be disclosed after they are first discovered.
- New tactics should have counterplay.
- The postmortem should explain what happened.

---

# 16. Threat Intel / Adversary Dossier

Do not add another spendable currency unless later playtesting proves it is needed.

For Stage 2, **Intel is collectible progress**, not money.

Example:

```text
GHOST-7

Profile completion: 45%

Known behavior
✓ Credential attacks
✓ Reuses breached passwords
✓ Prefers identity path

Unknown
?
?
?

Observed operations
7

Highest defeated threat
6
```

Intel/dossier entries unlock from:

- first encounter,
- defeating an adversary,
- encountering a new modifier,
- reaching an adversary rank milestone,
- story events.

This gives the player collection/progress without another economy to manage.

---

# 17. Story

The player is a security officer defending a fictional biotechnology research organization.

The final organization name should remain content-configurable so it can be changed without code changes.

Do not hard-code a real company identity.

## 17.1 Story delivery

Keep story short during normal play.

Preferred:

```text
2–4 sentence mission briefing
↓
gameplay
↓
1–3 sentence result/story beat
```

Longer optional information may live in:

```text
Incident Archive
Adversary Dossier
Story Log
```

The player can skip narrative screens.

## 17.2 Story progression

Story progression is based on gameplay milestones, not calendar time.

Example:

```text
Complete Stage 1 campaign
→ Operations unlocked
→ First adversary identified

Complete 5 Operations
→ next story beat

Reach GHOST-7 Rank 3
→ new tactic / story reveal

Complete first adversary boss Operation
→ next chapter
```

Exact milestone counts are content configuration.

## 17.3 Story structure target

Stage 2 should contain enough beats to create direction without requiring a huge writing project.

Recommended:

```text
Chapter 1
Existing five missions

Chapter 2
Operations begin
First recurring adversary

Chapter 3
Second/third adversary appears

Chapter 4
Evidence suggests coordinated targeting of the biolab

Chapter 5
Stage 2 major boss / unresolved hook for Stage 3
```

Stage 2 does not need a final ending.

---

# 18. Strategic Variety and Dominant-Strategy Prevention

Every repeatable Operation should aim to create at least two viable approaches.

Examples:

```text
Higher direct mitigation
vs
More detection/support

Specialize for the dominant threat
vs
Cover mixed threats

Spend early
vs
save for later waves

Use Security Engineer
vs
use SRE
```

## Balance rule

If the same tower combination wins nearly all unrelated templates, investigate it.

Telemetry should capture:

- defense pick rate,
- defense win rate,
- hero pick rate,
- hero win rate,
- Tower upgrade ownership,
- first-wave placement,
- upgrade order,
- final build,
- failed threat type.

Do not automatically nerf based on a single metric. Context matters.

---

# 19. Progression Without Automatic Victory

Stage 2 needs satisfying power growth, but grinding should not replace strategy.

Keep the Stage 1 principle:

> Knowledge and decisions should matter more than raw grinding.

Permanent progression should primarily provide:

- more strategic options,
- better information,
- hero specialization,
- modest efficiency,
- convenience,
- visible ownership/progress.

Avoid:

```text
Tower Level 20:
all defenses deal +500% damage
```

A veteran should feel stronger, but still need to build correctly.

Recommended ceiling for generic permanent combat bonuses:

```text
small-to-moderate, not enough to invalidate counter relationships
```

Specific balance numbers must be established through playtesting.

---

# 20. Stage 2 UI Information Architecture

## 20.1 Cyber Defense home

Replace the current "mission list is the whole game" feeling.

Recommended layout:

```text
CYBER DEFENSE

Officer
Security Analyst — Lv 8
████████░░

Tower Level 5
Bits: 1,840

Current Threat
GHOST-7 — Rank 4

----------------------------------

RECOMMENDED OPERATION

Threat Level 5
Identity breach
~8 min

[ CONTINUE DEFENSE ]

----------------------------------

Tower
Heroes
Threat Intel
Campaign
Operations
```

Do not show every sub-stat above the fold.

## 20.2 Primary CTA

There should almost always be one obvious action:

```text
CONTINUE DEFENSE
```

Behavior:

- new player → next Stage 1 campaign mission,
- completed Stage 1 → recommended Operation,
- unfinished run → Resume Operation,
- pending story beat → story beat then recommended Operation.

## 20.3 Post-operation result

Do not create five separate reward modals.

Use one concise sequence:

```text
OPERATION COMPLETE

★★★

+82 Bits
+110 Officer XP
+95 Security Engineer XP

Security Engineer
Lv 7 → Lv 8

Tower upgrade now affordable:
Threat Intelligence Lv 3

[CONTINUE]
```

The player may click details for:

- blocked threats,
- postmortem,
- dossier discovery,
- statistics.

## 20.4 Tower screen

Prioritize:

- visual building,
- affordable upgrade indicator,
- next benefit,
- current level,
- cost.

Do not show a spreadsheet of 40 modifiers.

## 20.5 Hero screen

Show:

```text
Hero art
Level / XP
Current ability
Next milestone
Selected talents
```

Detailed numeric stats can be expandable.

---

# 21. ADHD-Friendly Interaction Requirements

The broader product is designed to minimize unnecessary cognitive load. Preserve that here.

Requirements:

- one obvious primary next action,
- short play sessions,
- resumable operations,
- no huge choice wall,
- concise briefings,
- progress visible without opening several screens,
- explain failure immediately,
- avoid requiring memorization of prior wave details,
- use icons + text, not icons alone,
- avoid tiny text,
- avoid forced long animations,
- no penalty for closing the game,
- no daily FOMO,
- pause must remain available,
- avoid stacked reward popups.

---

# 22. Operation Modifiers

Stage 2 needs enough variation to reuse existing content for months.

Start with a small modifier library.

Examples:

## Hidden Traffic

Some attacks begin unidentified until Detection is online.

## Tight Budget

Lower starting mission credits.

## Strict Latency

Lower latency target for bonus stars.

## Surge

One wave contains a much larger number of swarm enemies.

## Mixed Vector

Two attack families occur in the same wave.

## Accelerated Attack

A specific enemy family moves moderately faster.

## Hardened Campaign

A specific family has moderately more attack effort/health.

## Limited Arsenal

A small number of defenses are unavailable.

Use carefully: never remove every reasonable counter.

## Recovery Pressure

Higher likelihood of ransomware / impact-oriented attacks.

### Modifier requirement

Every modifier must:

1. be visible before the Operation unless hiding it is itself a Threat Intel mechanic,
2. have at least one reasonable counter,
3. not contradict the security model,
4. not make the generated Operation mathematically unwinnable.

---

# 23. Operation Generation Safety

Procedural generation must never be unconstrained randomization.

For each Operation template define:

- minimum viable budget,
- valid defense set,
- mandatory counters,
- allowed modifiers,
- maximum modifier count,
- threat-level scaling bounds,
- canonical test strategy.

Example invariant:

```text
If SQL Injection is the primary threat,
the generated Operation must make at least one meaningful SQLi counter available.
```

Example:

```text
Do not generate:
SQL Injection-heavy Operation
+
Parameterized Queries unavailable
+
WAF unavailable
+
budget too low for remaining application defenses
```

---

# 24. Backend Architecture

Active simulation remains browser-side.

Do not add per-tick API calls.

Backend becomes authoritative for:

```text
Cyber Defense profile
Bits
XP
Hero level
Hero talents
Tower upgrades
Adversary rank
Story progress
Operation issuance
Operation reward settlement
```

Frontend remains authoritative only for transient simulation state:

```text
enemy positions
current tower placement
mission credits
wave timers
hero cooldown during the run
visual effects
```

---

# 25. Recommended Database Model

Names may be adjusted to repository conventions.

## 25.1 `cyber_defense_profiles`

Suggested fields:

```text
user_id PK/FK
xp
level
total_operations_completed
highest_threat_level_cleared
recommended_threat_level
active_story_chapter
created_at
updated_at
```

Level may be derived from XP instead of stored if that is safer.

## 25.2 `cyber_hero_progress`

```text
user_id
hero_id
xp
level
selected_talents JSONB or normalized relation
created_at
updated_at

PRIMARY KEY (user_id, hero_id)
```

Prefer deriving level from XP when practical.

## 25.3 `cyber_tower_upgrades`

```text
user_id
upgrade_id
level
updated_at

PRIMARY KEY (user_id, upgrade_id)
```

## 25.4 `cyber_adversary_progress`

```text
user_id
adversary_id
rank
encounters
victories
highest_threat_level_cleared
dossier_flags JSONB
updated_at

PRIMARY KEY (user_id, adversary_id)
```

## 25.5 `cyber_story_progress`

Either:

```text
user_id
story_node_id
completed_at
```

or a compact profile JSON structure if the number of story flags remains small.

Prefer explicit rows if story branching becomes important.

## 25.6 `cyber_operation_runs`

```text
id UUID PK
user_id
seed
template_id
adversary_id
threat_level
status
started_at
completed_at

result_health
result_stars
duration_ms

bits_awarded
player_xp_awarded
hero_id
hero_xp_awarded

reward_event_id
```

Store enough information for:

- idempotency,
- support/debugging,
- analytics,
- abuse detection,
- future deterministic replay validation.

---

# 26. API Design

Exact endpoint naming may follow existing API conventions.

Recommended Stage 2 surface:

## Profile

```http
GET /v1/cyber-defense/profile
```

Returns:

- career progression,
- heroes,
- Tower,
- adversaries,
- story,
- Bits balance or wallet reference,
- recommended Threat Level.

## Start Operation

```http
POST /v1/cyber-defense/operations
```

Request may include:

```json
{
  "requested_threat_level": 5,
  "hero_id": "security_engineer"
}
```

Server returns:

```json
{
  "run_id": "...",
  "seed": "...",
  "template_id": "...",
  "adversary_id": "ghost-7",
  "threat_level": 5,
  "operation": { "...": "deterministic configuration" }
}
```

The server should select or validate an Operation compatible with current progression.

## Complete Operation

```http
POST /v1/cyber-defense/operations/{run_id}/complete
```

Returns server-settled:

```json
{
  "completed": true,
  "bits_awarded": 82,
  "bits_balance": 1840,
  "player_xp_awarded": 110,
  "hero_xp_awarded": 95,
  "level_changes": [],
  "tower_unlocks": [],
  "adversary_changes": [],
  "story_events": []
}
```

Completion must be idempotent.

## Tower upgrade

```http
POST /v1/cyber-defense/tower/upgrades/{upgrade_id}
```

The server:

- validates prerequisites,
- derives cost,
- locks wallet/progression as needed,
- spends Bits atomically,
- increments exactly once.

## Hero talent selection

```http
PUT /v1/cyber-defense/heroes/{hero_id}/talents
```

The server validates:

- required hero level,
- legal talent choice,
- legal slot,
- respec rules.

---

# 27. Bits Migration From Stage 1

Stage 1 currently has a Cyber Defense endpoint that permanently debits Bits for temporary in-run control upgrades.

Stage 2 should deprecate this behavior.

## Required migration behavior

1. In-run defense upgrades use mission credits.
2. Frontend no longer queues Bits spends for temporary upgrades.
3. Existing `/v1/cyber-defense/upgrades` should be:
   - removed if no released client depends on it, or
   - kept temporarily as deprecated compatibility behavior.
4. If real users have already lost persistent Bits to Stage 1 temporary upgrades:
   - inspect the existing spend ledger,
   - perform an idempotent one-time refund or transition grant,
   - ensure it cannot be claimed twice.

Do not silently strand early users' currency if Stage 1 debit records exist.

---

# 28. Stage 1 Local Progress Migration

Current Stage 1 mission progress is browser-local.

Stage 2 progression is server-side.

On first Stage 2 launch:

1. Load existing local Stage 1 mission progress.
2. Import completion/stars/best-health as legacy campaign progress.
3. Do **not** grant retroactive repeatable economic rewards based solely on untrusted local data.
4. Mark legacy import complete.
5. Preserve the local copy until server acknowledgement succeeds.
6. After successful migration, server state becomes authoritative.

A user should not lose the fact that they already completed the five original missions.

---

# 29. Operation Reward Security / Anti-Cheat

Do not over-engineer anti-cheat, but persistent rewards require more protection than a client-only preview.

Minimum requirements:

- authenticated user,
- server-issued `run_id`,
- run belongs to user,
- run status must be active,
- server knows template/seed/threat level,
- completion reward calculated on server,
- one settlement per run,
- idempotent retries,
- plausible duration floor,
- maximum reward caps,
- rate limiting,
- no client-provided Bits amount,
- no client-provided XP amount,
- no negative/overflow values,
- no cross-user IDOR.

If abuse later matters, the current deterministic simulation makes future compact action-log replay validation possible.

Do not build full server simulation in Stage 2 unless necessary.

---

# 30. Important Current Bits Upgrade Issue

During Stage 1 review, the client upgrades a specific placement but the server's upgrade-spend sequence is associated with the run and `defense_id`.

Before keeping any portion of that flow, test multiple instances of the same defense type in the same run.

Stage 2's preferred solution is to remove persistent Bits spending from in-run upgrades entirely, which also removes this semantic mismatch.

Add a regression test so two identical towers can independently upgrade using mission credits.

---

# 31. Suggested New Frontend Data Modules

Keep data-driven design.

Possible additions:

```text
apps/web/src/game/data/
  adversaries.ts
  heroProgression.ts
  operationTemplates.ts
  operationModifiers.ts
  towerUpgrades.ts
  story.ts
  progression.ts

apps/web/src/game/models/
  adversary.ts
  operation.ts
  progression.ts
  tower.ts
  story.ts
```

Avoid embedding progression logic directly in React components.

---

# 32. Suggested Stage 2 Frontend Screens

Potential components:

```text
CyberDefenseDashboard
OperationCard
OperationBrowser
ThreatLevelSelector

TowerScreen
TowerRoom
TowerUpgradePanel

HeroProgressScreen
HeroTalentPanel

ThreatIntelScreen
AdversaryDossier

StoryBeat
StoryArchive

OperationRewardSummary
```

Reuse Stage 1 game components inside the Operation flow.

---

# 33. Failure Design

Failure should create:

```text
"I know what I should try differently."
```

not:

```text
"The game cheated."
```

Requirements:

- identify primary breach cause,
- show the relevant attack,
- explain which defense relationship mattered,
- allow immediate retry,
- preserve XP progress,
- recommend a lower Threat Level after repeated failures without automatically lowering it,
- never mock the player,
- do not remove permanent progress on failure.

---

# 34. Casual-Months Progression Target

Stage 2 should be designed for a player who plays roughly:

```text
2–5 Operations per week
```

without requiring that schedule.

A target content/progression horizon:

```text
8–16 weeks of visible progression
```

for a casual player.

A player who binges the game is allowed to progress faster. Do not artificially stop them with calendar gates.

Use several parallel progress tracks so one bar is usually close to moving:

```text
Officer XP
Hero XP
Tower upgrade affordability
Adversary dossier
Adversary rank
Story milestone
Highest Threat Level
```

Do not make all of them use separate currencies.

---

# 35. Balance Targets

These are starting targets, not immutable rules.

## Recommended Threat Level

Target completion rate after the onboarding period:

```text
roughly 60–80%
```

A recommended level should be challenging enough that decisions matter but not so punishing that casual players repeatedly brick-wall.

## Higher optional levels

Expected to be harder.

The player chose the risk.

## Early Stage 1 campaign

Should remain forgiving enough to teach mechanics.

## Hero impact

A hero should materially help but should not make bad architecture irrelevant.

## Tower progression

Permanent bonuses should help but not erase attack/control counter relationships.

---

# 36. Telemetry

Add enough telemetry to balance Stage 2.

Do not collect unnecessary personal information.

Recommended events:

```text
cyber_dashboard_view
operation_offered
operation_started
operation_resumed
operation_completed
operation_failed
operation_abandoned

threat_level_selected

defense_placed
defense_upgraded
defense_removed

hero_selected
hero_deployed

tower_upgrade_viewed
tower_upgrade_purchased

hero_level_up
hero_talent_selected

adversary_rank_up
dossier_entry_unlocked
story_beat_seen
```

Useful aggregated metrics:

- number of players who play another Operation after campaign completion,
- voluntary replay rate,
- Operations per session,
- median Operation duration,
- failure rate by threat level,
- retry-after-failure rate,
- defense pick rate,
- defense win rate,
- hero pick rate,
- hero win rate,
- Bits earned vs spent,
- median Bits balance,
- time between Tower purchases,
- progression velocity,
- operation-template repetition,
- abandon location.

### Primary qualitative success measure

The player should voluntarily continue after no new fixed mission is required.

Do not optimize only for raw session length.

---

# 37. Testing Plan

Testing is a Stage 2 requirement, not cleanup work.

## 37.1 Existing Stage 1 regression tests

All current Stage 1 tests must continue to pass unless a test intentionally changes due to the mission-credit upgrade migration.

Preserve tests covering:

- defense placement,
- invalid placement,
- pad occupation,
- gate behavior,
- heroes,
- hero cooldowns,
- tower combat,
- wave bonuses,
- early calls,
- SQLi behavior,
- credential stuffing,
- mixed defense,
- boss summons,
- backup,
- postmortem,
- mission resume.

---

## 37.2 Progression unit tests

Test XP boundaries:

```text
0 XP
exact level threshold
threshold - 1
threshold + 1
multiple-level award
max configured level
```

Test:

- career level derivation,
- hero level derivation,
- milestone talent availability,
- Tower level derivation,
- adversary rank thresholds.

---

## 37.3 Bits tests

Required:

- Operation reward settles once.
- Duplicate completion returns same settled result without duplicate Bits.
- Client cannot choose reward amount.
- Tower cost derived server-side.
- Insufficient Bits does not partially upgrade.
- Concurrent purchase attempts do not double-upgrade.
- Reused idempotency key for a different action is rejected.
- Wallet cannot become negative.
- Refund migration is idempotent if needed.
- In-run defense upgrades do not spend persistent Bits.
- Two same-type towers can upgrade independently with mission credits.

---

## 37.4 Operation generator tests

Required:

### Determinism

```text
same seed + same template + same threat level
→ same generated Operation
```

### Diversity

Different seeds should produce meaningful variation.

### Bounds

Generated values remain within template-defined safety ranges.

### Counter availability

Every primary threat has at least one meaningful counter available.

### Budget solvability

At least one known valid build fits the generated starting budget.

### Modifier compatibility

Disallowed combinations never occur.

### No impossible defense restriction

Limited Arsenal cannot remove every viable counter.

### Boss constraints

Boss Operations always include a valid path and counter strategy.

---

## 37.5 Adversary tests

- rank advances only on valid server events,
- rank does not advance twice on retry,
- new tactic unlock occurs at configured threshold,
- dossier unlock is idempotent,
- adversary rank does not force a Threat Level,
- all adversary IDs reference existing content,
- adversaries remain fictional.

---

## 37.6 Story tests

- original five missions unlock Chapter 2 correctly,
- story beat triggers once,
- skipped story remains marked appropriately,
- story does not block Operations if the presentation fails,
- story progress restores on another device,
- no story trigger depends on a daily login/calendar date.

---

## 37.7 API authorization tests

For every Stage 2 write endpoint:

- unauthenticated rejected,
- user A cannot mutate user B,
- unknown IDs rejected,
- invalid enum/content IDs rejected,
- malformed payload rejected,
- repeated requests are safe where idempotency applies.

---

## 37.8 Resume tests

Start Operation:

```text
place defenses
start wave
close/refresh
return
```

The Operation must restore correctly.

Also test:

- server profile refresh does not corrupt local active simulation,
- completed runs are not resumable,
- abandoned runs cannot settle twice.

---

## 37.9 UI tests

Desktop and mobile:

- dashboard has a single obvious primary CTA,
- Bits balance visible,
- XP progress readable,
- Tower screen works by touch,
- hero talents usable without hover,
- Threat Level selection understandable,
- reward summary does not overflow,
- dossier works on small screens,
- story can be skipped,
- back navigation does not lose an active run accidentally.

---

## 37.10 Accessibility tests

- keyboard navigation for meta screens,
- touch targets large enough for mobile,
- no state communicated by color alone,
- reduced-motion preference respected,
- pause remains usable,
- essential text is not auto-dismissed too quickly,
- readable focus state,
- semantic headings/labels,
- screen-reader names for progress bars and upgrade buttons.

---

## 37.11 Security-content correctness tests

Content-level validation should catch obviously misleading relationships.

Examples:

- Parameterized Queries must remain a strong SQLi counter.
- WAF must not be described as permanently fixing vulnerable code.
- Backup must not be described as preventing ransomware infection.
- Least Privilege must not be described as preventing every initial compromise.
- Monitoring must not be described as automatically blocking everything it detects.
- Rate Limiter must not be described as equivalent to MFA for Credential Stuffing.
- CSP must not be described as the sole universal XSS fix.

These can be snapshot/content tests plus manual review.

---

# 38. Implementation Sequence

Implement Stage 2 incrementally.

Do not attempt every subsystem in one giant branch/commit.

## Stage 2A — Economy and persistent profile

Goal:

> create the permanent foundation.

Implement:

- Cyber Defense server profile,
- career XP/level,
- real Operation/Campaign reward settlement,
- mission-credit tower upgrades,
- remove temporary persistent-Bits tower-upgrade spending,
- Tower upgrade persistence,
- legacy Stage 1 progress import,
- possible Stage 1 Bits refund migration,
- dashboard shell.

Exit criteria:

- original mission can award real server-settled Bits/XP,
- player can spend Bits on one permanent Tower upgrade,
- refresh/login on another device preserves progress.

---

## Stage 2B — Hero progression

Implement:

- persistent hero XP,
- level curve,
- hero progress UI,
- initial milestone talents,
- server validation,
- Operation reward hero XP.

Exit criteria:

- both existing Stage 1 heroes can level,
- leveling visibly changes something meaningful,
- no hero XP exploit from repeated client calls.

---

## Stage 2C — Repeatable Operations

Implement:

- Operation templates,
- seeded generator,
- Threat Level,
- recommended Threat Level,
- Operation start/complete APIs,
- resume,
- reward scaling,
- Operation browser with one recommended choice.

Exit criteria:

- player can finish original campaign and continue playing unlimited Operations,
- 20 generated runs do not all feel identical,
- generation does not produce impossible configurations.

This is the critical Stage 2 retention milestone.

---

## Stage 2D — Adversaries + Threat Intel

Implement:

- adversary data model,
- three initial fictional adversaries,
- adversary rank,
- tactic/modifier pools,
- dossiers,
- story hooks.

Exit criteria:

- Operations feel meaningfully different by adversary,
- rank progression changes possible tactics without silently forcing difficulty,
- dossier gives long-term collection progress.

---

## Stage 2E — Story and Tower polish

Implement:

- Chapter 1 framing around existing missions,
- Stage 2 story beats,
- Tower visual growth,
- chapter progression,
- reward/progression polish,
- telemetry dashboards/events,
- balance tuning.

Exit criteria:

- campaign ending transitions naturally into Operations,
- player understands why they should return,
- Tower visibly reflects permanent progress,
- no "finished everything" dead end remains after five missions.

---

# 39. Acceptance Criteria for Stage 2

Stage 2 is complete when all of the following are true.

## Long-term loop

- Completing the five original missions unlocks a repeatable system.
- There is no finite "all done" state after five missions.
- Operations can be generated indefinitely from curated templates.
- Operations remain deterministic by seed.
- Threat Level supports continued challenge.

## Progression

- Player/career XP persists server-side.
- Both existing heroes have persistent levels.
- Tower/HQ has persistent upgrades.
- At least three recurring adversaries have persistent dossier/rank progress.
- Story progresses based on gameplay milestones.
- Progress works across devices.

## Bits

- Cyber Defense actually awards Bits.
- Bits are server-authoritative.
- Bits have permanent uses.
- In-run tower upgrades use mission credits rather than persistent Bits.
- Reward settlement and spending are idempotent.
- Player can always continue playing with zero Bits.

## Fun / UX

- One primary "Continue Defense" action exists.
- Returning players can reach gameplay quickly.
- Story is skippable.
- No daily system exists.
- No forced waiting exists.
- No loot-box/gacha system exists.
- Failure gives understandable feedback.
- Mobile remains usable.

## Security education

- Existing security-control relationships remain accurate enough for learning.
- New content uses current OWASP/NIST/CISA/MITRE terminology carefully.
- No mechanic teaches obviously false security behavior.

## Quality

- Existing Stage 1 regression tests pass.
- New progression/economy/API tests pass.
- Operation-generation invariant tests pass.
- E2E flow from new user → campaign → Operations → Tower upgrade → hero level works.

---

# 40. Non-Goals / Do Not Add During Stage 2

Unless required to complete the systems above, do not add:

```text
More standalone game modes
PvP
Guilds
Multiplayer
Daily incidents
Daily streaks
Daily login rewards
Energy
Battle pass
Seasons
Gacha
Loot boxes
Paid Bits
Ads
Complex crafting
50-tower tech tree
Real-world threat actor impersonation
A detailed enterprise SOC simulator
```

The purpose of Stage 2 is depth and longevity from the **existing Tower Defense game**, not feature sprawl.

---

# 41. Coding-Agent Guardrails

When implementing this document:

1. Inspect existing implementation before changing architecture.
2. Reuse Stage 1 engine/model patterns.
3. Keep simulation browser-side.
4. Keep economy/progression server-authoritative.
5. Prefer data-driven definitions.
6. Avoid giant React components.
7. Avoid duplicating reward/progression math between frontend and backend.
8. Put server-authoritative calculations in Rust/server code.
9. Centralize balance constants.
10. Make migrations backward-compatible and idempotent where possible.
11. Add tests with each subsystem, not after the entire Stage 2 implementation.
12. Do not remove Stage 1 behavior merely because the new system exists.
13. Do not introduce hidden calendar/daily requirements.
14. Do not use `Oracle` as an adversary, hero, organization, boss, or story character name.
15. Do not use real threat-group names as fictional villains.
16. Do not make progression an automatic replacement for strategy.
17. Do not make a security control more powerful by teaching an incorrect security concept.
18. Preserve the ability to pause/resume and play short sessions.
19. Maintain mobile usability.
20. If a design choice conflicts with priorities, use:

```text
Fun
> Long-term replayability
> Meaningful Bits economy
> Security education
```

while still refusing to encode factually false security relationships.

---

# 42. Research References

## Game motivation / psychology / gamification

1. Ryan, Rigby, Przybylski — *The Motivational Pull of Video Games: A Self-Determination Theory Approach*  
   https://selfdeterminationtheory.org/SDT/documents/2006_RyanRigbyPrzybylski_MandE.pdf

2. Hamari et al. — *Challenging games help students learn: engagement, flow and immersion in game-based learning*  
   https://doi.org/10.1016/j.chb.2015.07.045

3. Gamification and intrinsic motivation meta-analysis  
   https://link.springer.com/article/10.1007/s11423-023-10337-7

4. Programming-learning gamification meta-analysis  
   https://onlinelibrary.wiley.com/doi/10.1002/cae.22630

5. 2026 systematic review on game dark patterns and random reward mechanisms  
   https://www.sciencedirect.com/science/article/pii/S1875952126000443

## Game design / difficulty / tower defense

6. Dynamic Difficulty Adjustment in Tower Defence  
   https://doi.org/10.1016/j.procs.2015.07.563

7. Comparing Dynamic Difficulty Adjustment Systems  
   https://doi.org/10.1145/3116595.3116623

8. Player tactic discovery in a commercial tower defense game  
   https://www.sciencedirect.com/science/article/pii/S1875952125000436

9. Risk/reward decision making under uncertainty  
   https://pubmed.ncbi.nlm.nih.gov/29567432/

## UI/UX / accessibility

10. Nielsen Norman Group — Ten Usability Heuristics  
    https://www.nngroup.com/articles/ten-usability-heuristics/

11. Microsoft Xbox Accessibility Guidelines  
    https://learn.microsoft.com/en-us/gaming/accessibility/

## Cybersecurity

12. NIST Cybersecurity Framework 2.0  
    https://www.nist.gov/publications/nist-cybersecurity-framework-csf-20

13. NIST SP 800-61 Rev. 3 — Incident Response  
    https://csrc.nist.gov/pubs/sp/800/61/r3/final

14. NIST SP 800-207 — Zero Trust Architecture  
    https://csrc.nist.gov/pubs/sp/800/207/final

15. MITRE ATT&CK Enterprise Tactics  
    https://attack.mitre.org/tactics/

16. MITRE ATT&CK Enterprise Techniques  
    https://attack.mitre.org/techniques/

17. OWASP Top 10:2025  
    https://top10.owasp.org/2025/

18. OWASP ASVS 5.0  
    https://github.com/OWASP/ASVS

19. OWASP SQL Injection Prevention Cheat Sheet  
    https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html

20. OWASP XSS Prevention Cheat Sheet  
    https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

21. OWASP Credential Stuffing Prevention Cheat Sheet  
    https://cheatsheetseries.owasp.org/cheatsheets/Credential_Stuffing_Prevention_Cheat_Sheet.html

22. CIS Critical Security Controls  
    https://www.cisecurity.org/controls

23. CISA MFA guidance  
    https://www.cisa.gov/audiences/small-and-medium-businesses/secure-your-business/require-multifactor-authentication

24. CISA StopRansomware Guide  
    https://www.cisa.gov/stopransomware/ransomware-guide

25. CISA network segmentation guidance  
    https://www.cisa.gov/sites/default/files/publications/layering-network-security-segmentation_infographic_508_0.pdf

---

# 43. Final Stage 2 Product Definition

Stage 1 built a working cybersecurity tower-defense game.

Stage 2 should turn it into a **persistent cyber-defense career**.

The player should have:

```text
a Tower that grows,
heroes that grow,
adversaries that evolve,
a story that continues,
operations that do not run out,
Bits that matter,
and increasingly difficult strategic decisions.
```

The game should remain easy to enter:

```text
Open Cyber Defense
↓
CONTINUE DEFENSE
↓
5–12 minute Operation
↓
Meaningful permanent progress
```

That is the Stage 2 target.
