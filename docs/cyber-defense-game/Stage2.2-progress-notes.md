# Stage 2.2 — Integrity + Replayability pass (completed)

Final summary lives in `Stage2-implementation-notes.md` (section
"Stage 2.2 — Integrity + Replayability Pass"). This file is the working
checklist.

## Audit (what existed / what was missing)

Already working: Stage 1 engine, five campaign missions with server settlement,
server-issued Operations, career/hero/Tower/adversary/story persistence, legacy
import, telemetry, durable pending settlement, dashboard/tower/heroes/intel/story
pages.

Gaps this pass closed:

1. Run-affecting progression was resolved from the *current* profile at mount.
2. No server-side campaign prerequisite enforcement.
3. No server-elapsed / claimed-duration / rate guard on settlement.
4. Random Operation pick was a single modulo choice.
5. No Operation offers.
6. Confrontation forced the recommended Threat Level.
7. All Operation maps were linear.
8. No permanent non-power Bits sink.
9. `POST /v1/cyber-defense/upgrades` was still mounted with a dead client queue.
10. Story acknowledgement was device-local.

## Phases

| Phase | Status | Result |
|---|---|---|
| 1 Immutable run snapshot | done | `OperationProgressionSnapshot`; server + browser use it |
| 2 Campaign order | done | `CAMPAIGN_ORDER` + `cyber_campaign_mission_locked` |
| 3 Settlement integrity | done | elapsed floor, duration tolerance, rate guard |
| 3 Campaign run IDs | deferred | documented as remaining limitation |
| 4 Anti-repetition selection | done | `select_operation_template` |
| 5 Operation offers | done | persisted, stable, `offer_id` start |
| 6 Confrontation Threat Level | done | chips shown; server validates |
| 7 Branching maps | done | dual-service, identity-fork, service-mesh |
| 8 Tower Themes | done | 5 cosmetics, Bits ledger, equip |
| 9 Story acknowledgement | deferred | plan documented |
| 10 Accelerated combat E2E | deferred | plan documented |
| 11 Remove legacy upgrades API | done | route/service/DTOs/queue removed |
| 12 Replayability review | done | generation + offer-variety tests |
| 13 Test matrix | done | domain + API + web + DB |
| 14 Commands | done | fmt, clippy, tests, lint, typecheck, build |
| 15 Docs | done | Stage 2 notes + Stage 1 note updated |

## Verified commands

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --no-fail-fast                         # local Postgres
cd apps/web && pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

`pnpm e2e` still requires local Postgres and the full API/web servers; the
Cyber Defense spec ages an Operation past the new integrity floor before
settling it through the real API.
