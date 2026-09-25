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

Cloudflare is connected to GitHub: merging to `main` builds and deploys the
frontend automatically. The Worker/static-assets config is
`apps/web/wrangler.jsonc` (`assets.directory: ./dist`,
`assets.not_found_handling: single-page-application`, which provides the SPA
fallback). To build and deploy manually:

```bash
cd apps/web
pnpm install --frozen-lockfile
pnpm build
npx wrangler deploy
```

Production environment variables (build-time, in Cloudflare, set for the
production branch):

- `VITE_API_BASE_URL` — the Cloud Run API origin, for example
  `https://api.<project>.run.app`.
- `VITE_WORKOS_CLIENT_ID` — the production WorkOS client id.
- `VITE_WORKOS_API_HOSTNAME` — leave empty for `api.workos.com`, or set it to a
  custom AuthKit authentication domain under this domain (recommended; see
  below). Never set it to the app's own host.

Custom domain: `learn.shidenlabs.com`, added as a Workers/Pages custom domain so
Cloudflare creates the DNS record and certificate.

Requirements:

- SPA fallback (provided by `not_found_handling`)
- immutable caching for hashed assets
- CSP
- explicit API origin (`VITE_API_BASE_URL`)
- no backend secrets

Cross-origin wiring that must match the deployed origin:

- API `CORS_ALLOWED_ORIGINS` must include `https://learn.shidenlabs.com`
  (comma-separated for staging plus production).
- WorkOS **Applications → Redirects** and **Authentication → allowed origins**
  must both include `https://learn.shidenlabs.com` (exact, no trailing slash),
  because the app sets `redirectUri={window.location.origin}`.

### Python runtime assets

Python exercises execute on a self-hosted, pinned Pyodide build. The assets are
build output and are git-ignored, so a release must sync them before building:

```bash
cd apps/web
pnpm sync:python   # public/python-runtime/pyodide/<pinned-version>/
pnpm build
pnpm verify:python # optional: exercise the pinned runtime and packages
```

- `sync:python` installs the interpreter plus the dependency closure of the
  approved packages (`numpy`, `pandas`, `matplotlib`), about 30 MB total. Every
  package wheel is verified against the SHA-256 in the pinned
  `pyodide-lock.json`. Use `--core-only` to skip the package wheels.
- `apps/web/public/_headers` serves `/python-runtime/*` with
  `Cache-Control: public, max-age=31536000, immutable`. The pinned version is in
  the URL, so bumping `PYODIDE_VERSION` is a new URL and no cache purge is
  needed.
- `/python-sandbox/*` gets a restrictive, sandbox-only CSP and a deny-all
  `Permissions-Policy` (see [Security and Privacy](14-security-privacy.md)).
- The PWA service worker excludes the runtime, the sandbox page, and the Python
  editor chunk from its install-time precache, so non-Python learners do not
  download them. The app shell (`index.html`) is deliberately **not** precached:
  page navigations use a network-first strategy, so a new deploy is picked up on
  the next load instead of a stale shell pointing at deleted hashed assets
  (which shows up as a blank page until the worker is cleared). The cached shell
  is only used when the network is unavailable. `python-runtime` and
  `/python-sandbox/` are excluded from the SPA navigation handling.

### Python sandbox origin

No separate domain is required. The sandbox runs on the app origin by default,
and learner Python is given **no JavaScript bridge** (`jsglobals: {}`), so it
cannot reach the app's storage, files, or the network. The worker platform
additionally has no `document`, `localStorage`, or `sessionStorage`.

A distinct origin is optional, stronger (browser-enforced) isolation. To use it,
set `VITE_PYTHON_SANDBOX_ORIGIN` to an origin that serves the same `dist`, for
example `https://python-sandbox.example.com`. It must serve no authenticated
content and share no auth cookies, tokens, or storage with the app, and the app
origin must be allowed in the sandbox CSP `frame-ancestors` in `public/_headers`
(the committed default allows `'self' https://*.shidenlabs.com`).

The Python/WASM heap is capped at 384 MiB by default (`VITE_PYTHON_MAX_MEMORY_MB`).
Over-budget allocations raise a catchable `MemoryError` rather than exhausting
the device.

`pnpm verify:python` asserts the empty JS bridge and the memory quota against the
pinned runtime; run it when bumping `PYODIDE_VERSION`.

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
- pooled connection string for the API; direct (non-pooled) string for migrations
- TLS
- small SQLx pool per Cloud Run instance

Migration flow:

```text
CI tests
-> approved migration job
-> smoke test
-> deploy compatible API
```

### Running migrations against Neon

Prerequisite: the SQLx CLI, built with the same driver features the API uses.

```bash
cargo install sqlx-cli --no-default-features --features rustls,postgres
```

Run migrations from CI or a one-off, approved job — not implicitly from the
long-running API service. Use Neon's **direct** (non-pooled) connection string
and TLS. The pooled host runs PgBouncer in transaction mode, which is not
appropriate for DDL or the migrator's advisory lock.

```bash
# Direct host: no "-pooler" suffix. Fix the region to match the project.
export DATABASE_URL='postgresql://USER:PASSWORD@ep-xxxx.<region>.aws.neon.tech/neondb?sslmode=require'

# Inspect pending vs applied migrations (and checksums), then apply the pending.
sqlx migrate info --source crates/db/migrations
sqlx migrate run  --source crates/db/migrations
```

SQLx records each applied migration, with its checksum, in `_sqlx_migrations`
and takes a Postgres advisory lock while running. `migrate run` therefore applies
only pending migrations and is safe to re-run; concurrent runs serialize. Never
edit a migration that has already been applied — the checksum changes and later
runs fail. Add a new migration instead.

Keep `RUN_MIGRATIONS=false` on the deployed API so no cold start or scale-out
event migrates.

### Rollback

Revert the most recently applied migration using its `*.down.sql`, then repeat to
step further back:

```bash
sqlx migrate revert --source crates/db/migrations
```

Destructive migrations require manual review and a rollback plan. Branch the
production Neon database (or confirm point-in-time restore) before applying them.

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
- exact redirect URIs and allowed origins (`https://learn.shidenlabs.com`)
- a custom AuthKit authentication domain before relying on sessions in
  production
- explicit session/token storage strategy
- logout/revocation path

Session persistence depends on the auth host. With the default `api.workos.com`
the session cookie is third-party and the SDK cannot restore the session, so the
web app enables the SDK's `devMode` and keeps the refresh token in
`localStorage` for the origin. A custom AuthKit domain (for example
`auth.shidenlabs.com`) makes the session a first-party httpOnly cookie, so
reloads and tabs work without `localStorage`; set `VITE_WORKOS_API_HOSTNAME` to
it and point the API at it with `WORKOS_ISSUER` / `WORKOS_JWKS_URL`. See
[Authentication](05-authentication.md).

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
