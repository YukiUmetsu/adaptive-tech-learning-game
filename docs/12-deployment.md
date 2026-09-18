# Deployment

## Environments

Use separate:

- local
- staging
- production

Separate WorkOS environments, Neon branches/projects, R2 prefixes/buckets, secrets, and model manifests.

## Infrastructure as code

Use OpenTofu/Terraform or equivalent for repeatable production infrastructure.

Manage at least:

- Cloud Run service/config
- service account/IAM
- R2 buckets/policies where supported
- DNS/domain configuration
- secrets references

Do not manage production only with manual console steps.

## Frontend — Cloudflare

```bash
cd apps/web
pnpm install --frozen-lockfile
pnpm build
```

Requirements:

- SPA fallback
- immutable caching for hashed assets
- CSP
- explicit API origin
- no backend secrets

## API — Cloud Run

Use a multi-stage Rust container build and deploy an immutable image digest.

Do **not** hardcode `us-central1` in canonical docs.

Region selection procedure:

1. choose 2-3 Cloud Run regions close to target users and Neon DB region
2. benchmark API -> Neon p50/p95 query latency
3. measure cross-cloud egress
4. select region from observed results

Example only:

```bash
gcloud run deploy tech-learning-api \
  --image "$IMAGE_DIGEST" \
  --region "$REGION" \
  --allow-unauthenticated \
  --min 0 \
  --concurrency 40 \
  --max 10
```

Cloud Run accepts public requests; the application validates WorkOS identity/authorization.

Start with:

```text
min instances: 0
concurrency: 20-80
max instances: 5-10
```

Tune against latency **and Neon connection budget**.

## Database — Neon

Use:

- production project
- staging branch/project
- pooled connection string
- TLS
- small SQLx pool per Cloud Run instance

Migration flow:

```text
CI tests
-> approved migration job
-> smoke test
-> deploy compatible API
```

Destructive migrations require manual review and rollback plan.

### Reliability gate

Before meaningful paid economy/purchases:

- configure provider restore capability
- run scheduled logical backup to independent object storage
- test restoration periodically
- alert on DB availability/errors
- evaluate a Neon tier with an SLA if business requirements need it

## R2

Buckets/prefixes:

```text
app-assets
learning-events
training-data
models
```

For high-volume telemetry:

1. API mints short-lived presigned PUT
2. client uploads compressed object to R2
3. client sends object key/checksum with authoritative sync
4. server records accepted reference
5. training consumes only accepted references

Presigned upload reduces API bandwidth; it does **not** establish data truth.

Add lifecycle policies for temporary/uncompacted data.

## Authentication — WorkOS

Production:

- Google OAuth
- Magic Auth code
- exact redirect URIs
- custom auth domain before launch if appropriate
- explicit session/token storage strategy
- logout/revocation path

Never put WorkOS API secret in the browser.

## CI/CD identity

Use GitHub Actions OIDC / workload identity federation or equivalent.

Do not store long-lived GCP service-account JSON keys in CI.

## CI/CD

```mermaid
flowchart LR
    PR[Pull request] --> CI[lint + test + build + security scan]
    CI --> Img[immutable container image]
    Img --> Stage[deploy staging]
    Stage --> Smoke[smoke/contract tests]
    Smoke --> Prod[controlled production promotion]
```

ML model promotion remains a separate pipeline.

## Observability

Minimum production metrics:

```text
API p50/p95/p99
DB query p95
DB pool utilization
sync conflict/retry rate
R2 upload failure rate
auth failure rate
reward rejection/fraud rate
cost per 1k sessions
model calibration
```

Logs:

- structured
- low-cardinality
- no secrets/tokens
- short default retention
- sample noisy success logs at scale

## Secrets

Use provider secret stores/CI secrets for:

- Neon URL
- WorkOS API key
- R2 keys

Never bake secrets into images or static assets.
