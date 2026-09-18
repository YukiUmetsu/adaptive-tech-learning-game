# Documentation Review

## Status

Updated after a strict architecture/security/ML review on 2026-09-18.

The original review found five material gaps. The current documents now address them.

## Resolved high-priority findings

| Finding | Resolution |
|---|---|
| client could fabricate scores/rewards | server-issued missions + canonical rescoring + pending offline rewards |
| recovery bonus could reward deliberate failure | first-pass >= recovery reward invariant; challenge frozen pre-attempt |
| multi-device/offline conflict semantics missing | event IDs/device sequence + per-state conflict rules |
| predictor accuracy conflated with teaching quality | separate student-model and teaching-policy evaluation |
| R2/Parquet account deletion vague | tombstones + immediate training exclusion + background partition rewrite |
| R2 SQL wording inaccurate | Iceberg/Data Catalog requirement documented |
| Cloud Run region hardcoded | benchmark API/DB region pair before selection |
| production reliability gate missing | backup/restore/SLA decision before paid economy |
| accessibility absent | keyboard/tap/reduced-motion/timer-off requirements added |

## Architecture verdict

### Keep

- native Rust + Axum
- SQLx + PostgreSQL
- Cloud Run scale-to-zero API
- Neon PostgreSQL
- Cloudflare R2
- WorkOS AuthKit
- local-first sessions
- local-first ML training
- one backend service initially

### Why

The major costs are database/network/storage/ML/observability, not Axum framework overhead. The selected boundaries remain portable:

```text
HTTP
PostgreSQL
S3-compatible object storage
OCI containers
```

## Remaining accepted risks

### Cross-provider network

Cloud Run -> Neon and Cloud Run/R2 span providers.

Control:

- benchmark colocated regions
- direct client -> R2 for bulk telemetry
- monitor egress and p95 DB latency

### Client answer inspection

Offline/local content may expose answer keys.

Control:

- server re-scores reward evidence
- non-transferable economy
- anomaly detection
- accept that V1 is not high-assurance proctoring

### Content workload

High-quality certification content may cost more engineering time than infrastructure.

Control:

- one narrow certification slice first
- coverage matrix
- source/version metadata
- content authoring tooling before catalog expansion

### Deep ML complexity

Deep KT may not beat simple baselines enough to justify cost.

Control:

- HLR + FSRS + DAS3H-style baselines
- strict holdouts/calibration
- online teaching-policy evaluation

## Cost principles

Priority order:

1. no per-question LLM
2. no per-drag API calls
3. scale-to-zero API
4. scale-to-zero/usage DB early
5. raw history in object storage
6. compact small objects
7. train locally until inconvenient
8. control logging/observability cost

## Production-readiness gates

Before public paid launch:

- authoritative mission/reward protocol implemented
- restore tested from independent DB backup
- multi-device conflict tests pass
- account deletion workflow tested end-to-end
- auth/session threat review complete
- economy replay/farming tests pass
- accessibility alternatives present
- model calibration dashboard operational

## Intentionally deferred

- product name
- pricing
- first certification
- exact game art style
- native mobile framework
- final deep KT architecture
- paid gacha policy
- realtime social features
