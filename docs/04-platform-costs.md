# Platform and Cost Analysis

Prices change. Re-check before production commitments. Figures below were verified on 2026-09-18.

## Selected providers

### Frontend: Cloudflare static assets

Static asset requests are free and unlimited, with no additional asset storage charge for Workers static assets.

**Decision:** use for the web/PWA bundle.

**Why:** the frontend should not generate a per-page infrastructure bill.

Source: <https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/>

### Rust API: Google Cloud Run

Request-based Cloud Run currently includes per month:

- 2M requests
- 180,000 vCPU-seconds
- 360,000 GiB-seconds RAM

Beyond the request allowance, default request pricing is $0.40/M requests plus compute.

**Decision:** use Cloud Run with minimum instances = 0.

**Why:** standard container, scale-to-zero, low early cost, easy migration later.

Source: <https://cloud.google.com/run/pricing>

### PostgreSQL: Neon

Free plan currently includes per project:

- 50 CU-hours/month
- 0.5 GB storage
- scale-to-zero after inactivity

Launch is usage based with no minimum. Published compute pricing is $0.106/CU-hour after Neon's 2025 price reduction.

**Decision:** Neon Postgres.

**Why:** real PostgreSQL without paying for an always-on DB during early usage.

**Reliability note:** Free/Launch is appropriate for development/early production, but do not assume the same SLA as higher Neon tiers. Before meaningful paid economy, require independent backup + restore testing and evaluate an SLA-backed tier if needed.

Sources:

- <https://neon.com/blog/new-usage-based-pricing>
- <https://neon.com/blog/major-compute-price-reduction-on-neon>

### Object storage: Cloudflare R2

Standard storage:

- 10 GB-month free
- then $0.015/GB-month
- 1M Class A operations free
- 10M Class B operations free
- internet egress free

**Decision:** raw events, Parquet, models, large game/content assets.

Source: <https://developers.cloudflare.com/r2/pricing/>

At large scale, Class A operations matter. With 1M MAU × 20 session uploads/month, one object per session would be ~20M PUTs/month. After the first 1M free Class A operations, the write-operation component alone is roughly $85.50/month at current pricing. Add hourly/daily compaction and avoid one object per individual event.

### Auth: WorkOS AuthKit

AuthKit is currently free for up to 1M MAU. OAuth connections are free. Production still requires billing information.

**Decision:** WorkOS AuthKit.

**Why:** removes auth implementation risk and is materially cheaper than many MAU-priced providers at product scale.

Source: <https://workos.com/docs/authkit/environments>

### ML training

**Local first:** $0 incremental cloud cost.

**Modal:** Starter currently includes $30/month compute credit.

**RunPod:** current secure-cloud examples include A5000 $0.27/h, 3090 $0.50/h, 4090 $0.74/h, A100 80 GB $1.59/h.

Sources:

- <https://modal.com/pricing>
- <https://www.runpod.io/pricing>

## Cost model

Assumptions for planning only:

```text
20 study sessions / MAU / month
3 API requests / session
25 quiz events / session
events uploaded in one batch / session
```

Therefore:

```text
API requests/month ≈ MAU * 60
event batches/month ≈ MAU * 20
events/month ≈ MAU * 500
```

Examples:

| MAU | API requests/mo | Approx. cost character |
|---:|---:|---|
| 1k | 60k | likely within free tiers |
| 10k | 600k | likely within Cloud Run request free tier |
| 100k | 6M | Cloud Run request overage only ~$1.60 before CPU/RAM; DB becomes more important |
| 1M | 60M | optimize DB duty cycle, batching, API latency and auth pricing before micro-optimizing Rust |

Google's own Cloud Run example prices 10M requests at $13.69 for a 400ms, 1 vCPU/512MiB, concurrency-20 service. A thin Rust API should target substantially lower per-request work, but do not budget from an assumed benchmark.

## Biggest cost risks

In priority order:

1. LLM calls per question.
2. Database queries/writes per interaction.
3. Always-on compute.
4. Storing raw history in an indexed transactional DB.
5. Large media egress from a provider that charges bandwidth.
6. GPU instances left running.
7. Observability/log retention at scale.
8. Cross-provider transfer: Cloud Run -> Neon and any API-proxied R2 bytes.
9. R2 Class A operations from excessive tiny objects.
10. Framework micro-overhead.

## Cost rules

- 2-5 API requests per study session.
- Batch DB writes.
- No per-question LLM.
- Min Cloud Run instances = 0 until latency requires otherwise.
- Small Postgres connection pool per API instance.
- R2 objects should contain batches, not one object per drag/event.
- Compact raw session objects into larger partitioned Parquet/Iceberg files.
- If API -> R2 transfer becomes material, use short-lived presigned client uploads and validate accepted batch references in Postgres.
- GPU job starts for training and terminates after artifact upload.
- Introduce another provider only if it removes a meaningful bottleneck or saves meaningful money.

## When to reconsider providers

Re-evaluate Neon when:

- compute no longer scales down materially
- Postgres is continuously active
- DB is >30-40% of infrastructure spend
- connection limits constrain Cloud Run scaling

At that point compare:

- larger Neon plan
- another managed Postgres
- dedicated/self-hosted Postgres

Do not migrate merely because MAU increased.

## Cross-provider cost rule

The selected stack intentionally spans providers. Track these separately:

```text
Cloud Run -> Neon request/response bytes
Cloud Run -> R2 bytes if API proxies uploads
R2 operation count
Neon compute duty cycle
```

If cross-cloud transfer exceeds ~10% of infrastructure spend, revisit region placement or data path before changing language/framework.
