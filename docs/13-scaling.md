# Scaling Plan

Scale from workload metrics, not MAU alone.

## Stage 0 — development / early users

- Cloudflare static frontend
- one Cloud Run Rust service
- Neon Free/Launch
- R2
- WorkOS
- local ML training

No Redis, queue, microservices, or Kubernetes.

## Stage 1 — optimize the simple architecture

Focus on:

- batch sync
- indexes/query plans
- Cloud Run concurrency
- Neon pool/connection budget
- direct client -> R2 telemetry upload where useful
- cost/session dashboard
- raw-object compaction

## Stage 2 — larger event volume

Likely bottleneck: database/data pipeline, not Axum CPU.

Actions:

- compact session objects to partitioned Parquet
- delete raw objects after retention/verified compaction
- keep historical telemetry out of hot Postgres tables
- use a queue only for work not required for immediate authoritative response
- monitor R2 Class A operations and small-file count

## Stage 3 — sustained traffic

Evaluate:

- Neon usage vs dedicated managed Postgres
- DB reliability/SLA tier
- regional API placement
- cross-cloud egress
- model inference cost

Potential service separation only when scaling/security differs materially:

```text
core API/economy
raw-event ingestion/compaction
ML inference
```

## Stage 4 — very large scale

Before crossing major provider price thresholds:

- negotiate pricing
- compare dedicated Postgres
- re-evaluate AuthKit beyond its free-MAU boundary
- compare cold archive providers if storage savings are material
- reserve/commit compute only for stable baseline load

## Portability

Standard PostgreSQL + SQLx:

```text
Neon -> another managed Postgres -> dedicated Postgres
```

OCI Rust container:

```text
Cloud Run -> another container host -> VM/Kubernetes if ever justified
```

## Scaling triggers

| Metric | Trigger/action |
|---|---|
| DB >35% infra spend | compare DB alternatives |
| p95 API >300ms | profile DB/network/API |
| DB connections >70% limit | reduce pool/tune max instances |
| sync payload >1MB typical | compress/segment |
| training >1h daily | move local -> cloud job |
| inference >20% API cost | batch/cache/separate |
| R2 Class A cost material | compact/batch uploads |
| small object count hurts analytics | compact to Parquet/Iceberg |
| cross-cloud egress >10% spend | redesign transfer path/region |
| paid economy launches | backup/SLA/restore gate |

Thresholds are starting points; adjust from production data.
