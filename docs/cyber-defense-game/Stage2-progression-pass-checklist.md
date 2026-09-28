# Stage 2 "Progression actually matters" pass — checklist (completed)

Working notes for the pass that made existing Stage 2 progression affect real
gameplay. Full details, constants, tests, and deferrals are in
`Stage2-implementation-notes.md`.

## Audit summary (what already worked)

- Stage 1 engine: deterministic browser simulation, waves, placements, mission-credit
  upgrades, heroes, synergies, postmortem, stars.
- Stage 2 server: profile, career/hero XP, Tower/HQ purchases, Operation
  start/complete/abandon, adversaries, dossier, story, legacy import, telemetry.
- `resolveHeroRuntime()` existed but was not wired into a battle's catalog.
- Dashboard started Operations with no operator/threat choice.
- `OperationBriefing` revealed everything regardless of Tower level.
- Tower room benefits were descriptive only.

## Phases

| Phase | Status | Result |
|---|---|---|
| 2 Hero talents in combat | done | `data/heroRuntime.ts`, `hooks/useFrozenHeroTalents.ts`; tests |
| 3 Choose hero | done | `dashboard/OperationSetup.tsx`, `persistence/heroSelection.ts` |
| 4 Tower/HQ effects | done | SOC/TI gating, Training Center XP, Engineering Lab loadout, Resilience recovery + postmortem |
| 5 Briefing intel visibility | done | `data/towerEffects.ts`, rewritten `OperationBriefing.tsx` |
| 6 Threat level choice | done | `OperationSetup` uses server `unlocked_threat_level` |
| 7 Cross-device unlock | done | `data/campaignUnlock.ts`; dashboard + mission page |
| 8 Server campaign→ops lock | done | `403 cyber_operations_locked`; API test |
| 9 Story-gate adversaries | done | `available_adversaries`; API tests |
| 10 Durable pending settlement | done | `state/pendingSettlements.ts`; tests |
| 11 Climax requires a battle | done | `ghost7-confrontation` template + trigger; API test |
| 12 Telemetry events | done | placed/upgraded/removed, hero, Tower, talent, rank, dossier, story |
| 13 Tests | done | domain + API + frontend suites green |
| 14 E2E | deferred | no authenticated Cyber Defense Playwright fixture; documented |

## Deferred (documented, not faked)

- Training Center Lv3 multi-loadout system (free respec already exists; Lv3 adds
  ×1.15 hero XP instead).
- Operation template browsing.
- Cyber Defense Playwright E2E.
