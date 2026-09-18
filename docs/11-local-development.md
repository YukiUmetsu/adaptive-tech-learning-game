# Local Development

## Repository layout

```text
apps/
  api/       Rust + Axum API (library + binary + OpenAPI export)
  web/       React + TypeScript + Vite PWA
crates/
  content/   versioned certification content schema, validation, and scoring
  domain/    core types and invariants
  db/        PostgreSQL pool, SQLx migrations, persistence
content/     authored certification bundles (JSON)
ml/          Python 3.12 + uv evaluation utilities (no model yet)
infra/       deployment documentation only; nothing is deployed
docs/        architecture and design documents
```

`crates/economy`, `crates/planner`, and `crates/sync` are intentionally absent.
Add them when they have a concrete purpose.

## Prerequisites

- Rust stable (`rustup` recommended)
- Node.js LTS
- `pnpm`
- Docker / Docker Compose
- Python 3.12+
- `uv`

`sqlx-cli` is optional. Migrations are embedded in the API and can be applied at
startup; install the CLI only if you want manual migration control:

```bash
cargo install sqlx-cli --no-default-features --features rustls,postgres
```

## First-time setup

```bash
# 1. Local infrastructure (PostgreSQL only)
docker compose up -d

# 2. API environment
cp .env.example .env

# 3. Web dependencies and environment
cd apps/web
pnpm install
cp .env.example .env.local
cd ../..

# 4. ML environment
cd ml
uv sync
cd ..
```

Never commit real secrets. `.env` files are git-ignored.

## Run everything locally

```bash
# API (applies embedded migrations when RUN_MIGRATIONS=true)
cargo run -p adaptive-learn-api

# Web (separate terminal)
cd apps/web
pnpm dev
```

- API: <http://localhost:8080>
- API health: <http://localhost:8080/health>
- API OpenAPI: <http://localhost:8080/openapi.json>
- Web: <http://localhost:5173>

The web dev server proxies `/v1` and `/health` to `VITE_API_PROXY_TARGET`
(default `http://localhost:8080`), so the browser never makes a cross-origin
request and CORS is not involved in local development. If the API binds a
different port, set `BIND_ADDR` when starting it and set
`VITE_API_PROXY_TARGET` in `apps/web/.env.local` to match.

If port 5432 is already in use, set `POSTGRES_PORT` when starting Docker and
update `DATABASE_URL` to match:

```bash
POSTGRES_PORT=55432 docker compose up -d
DATABASE_URL=postgres://app:app@localhost:55432/app cargo run -p adaptive-learn-api
```

## Phase 1 learning MVP (AWS SOA-C03)

Phase 1 ships one real, narrow module:

- Certification: AWS Certified CloudOps Engineer - Associate (`aws-soa-c03`, `SOA-C03`).
- Domain 1: Monitoring, Logging, Analysis, Remediation, and Performance Optimization.
- Task 1.1: Implement metrics, alarms, and filters by using AWS monitoring and logging services.

Only Task 1.1 has authored questions. The other domains exist as exam metadata
(with official weights) and are explicitly marked "not yet authored" in the UI.

Content is authored as versioned JSON at
`content/aws/soa-c03/soa-c03-content-v1.json`. It is embedded in the API binary,
validated at startup, and rejected if concept references, canonical answers,
weights, identifiers, or versions are invalid. Canonical answers are never sent
with a mission; they are returned only after an answer is scored.

Key API endpoints:

```text
GET  /v1/certifications
POST /v1/missions/issue
POST /v1/missions/{mission_id}/answers
POST /v1/missions/{mission_id}/complete
POST /v1/sync
```

Learning progress is stored locally (device id, active mission, per-question
attempts, and pending events) so a refresh resumes the mission. Evaluated
attempts are reconciled in one `/v1/sync` batch when the mission finishes; if
sync fails, events remain pending and can be retried from the summary.

### Known Phase 1 limitations

- **Request count.** A five-question mission makes roughly seven to nine API
  requests (issue, one scoring request per attempt, completion, and one batched
  sync), above the 2-5 target in the architecture docs. Per-question scoring is
  required for immediate, server-authoritative feedback while keeping canonical
  answers off the client; batching that further is a Phase 2 concern.
- **Sync authority.** `/answers` is stateless scoring for feedback and reveals
  the canonical answer after an attempt is submitted. Authoritative event
  persistence and attempt numbering happen at `/sync`, where the server
  re-scores primitives and derives `attempt_number` from accepted evidence.
  Hints are not implemented, so the server records `hint_count = 0`.
- **Device-scoped ownership.** Requests are keyed by a client-generated
  `device_id`; there is no authenticated identity yet. Ownership checks are
  therefore not cryptographic. WorkOS AuthKit and subject ↔ device binding are
  a Phase 2 requirement before any economy exists.
- **Mission expiry.** `expires_at` is issued and stored but not enforced.
- **Storage.** Progress uses `localStorage`. If storage is unavailable the
  runner surfaces a warning rather than silently losing evidence; synced events
  are removed from the pending queue.
- **Content scope.** Only SOA-C03 Domain 1 / Task 1.1 has authored questions.
  Domains 2-5 are blueprint metadata only, and the equation interaction is not
  implemented yet.

## Database migrations

Migrations live in `crates/db/migrations/` as reversible
`*.up.sql` / `*.down.sql` pairs. The API applies them at startup when
`RUN_MIGRATIONS=true` (the local default). To manage them manually:

```bash
export DATABASE_URL=postgres://app:app@localhost:5432/app
sqlx migrate run --source crates/db/migrations
sqlx migrate revert --source crates/db/migrations
```

The migration test creates an isolated database, applies and reverts the
migrations, then drops it.

## API contract generation

Rust response types are the source of truth for the HTTP contract. Regenerate
the OpenAPI document and TypeScript types after changing API types:

```bash
cd apps/web
pnpm generate:api
```

This writes `apps/web/openapi.json` and `apps/web/src/api/schema.d.ts`; commit
both so the web build works without a Rust toolchain. The API also serves the
same document at `/openapi.json`.

## Environment variables

| Variable | Purpose | Notes |
|---|---|---|
| `APP_ENV` | `local`, `test`, `staging`, `production` | defaults to `local` |
| `BIND_ADDR` | API listen address | defaults to `0.0.0.0:8080` |
| `DATABASE_URL` | PostgreSQL connection string | required |
| `DATABASE_MAX_CONNECTIONS` | pool size per instance | defaults to `5` |
| `RUN_MIGRATIONS` | apply embedded migrations at startup | local/test default `true` |
| `CORS_ALLOWED_ORIGINS` | comma-separated browser origins | local default `http://localhost:5173` |
| `REQUEST_TIMEOUT_SECONDS` | per-request timeout | defaults to `30` |
| `REQUEST_BODY_LIMIT_BYTES` | maximum request body | defaults to `1 MiB` |
| `LOG_FORMAT` | `pretty` or `json` | `json` default in production |
| `RUST_LOG` | tracing filter | e.g. `info,tower_http=debug` |
| `WORKOS_CLIENT_ID` / `WORKOS_API_KEY` | WorkOS AuthKit | set together or both empty |
| `WORKOS_ISSUER` | expected token issuer | optional |
| `R2_*` | Cloudflare R2 | unused in Phase 0 |
| `VITE_API_PROXY_TARGET` | dev/preview proxy target for `/v1` and `/health` | `apps/web/.env.local`; defaults to `http://localhost:8080` |
| `VITE_API_BASE_URL` | web → API origin | set only when the API is on a different origin than the web app |

Authentication is not wired to any route in Phase 0. WorkOS values are loaded
and validated as a configuration boundary only; see
[Authentication](05-authentication.md).

## ML environment

```bash
cd ml
uv sync
uv run pytest
```

There is no training entrypoint in Phase 0. HLR/FSRS/DAS3H work begins in a
later phase.

## Tests and checks

### Rust

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

Database-backed tests run when `DATABASE_URL` is set and are skipped otherwise.
CI sets `REQUIRE_DB_TESTS=1` so a missing database fails instead of silently
skipping:

```bash
docker compose up -d
DATABASE_URL=postgres://app:app@localhost:5432/app REQUIRE_DB_TESTS=1 cargo test
```

### Web

```bash
cd apps/web
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### End-to-end (Playwright)

Playwright starts the Rust API and the Vite dev server through `webServer`, so
PostgreSQL must be running and reachable. Prefer a dedicated database:

```bash
docker compose up -d
cd apps/web
E2E_DATABASE_URL=postgres://app:app@localhost:5432/app_e2e pnpm e2e
```

- `E2E_DATABASE_URL` falls back to `DATABASE_URL`, then to
  `postgres://app:app@localhost:5432/app`.
- `E2E_API_PORT` and `E2E_WEB_PORT` override the default ports (8080/5173) when
  they are already in use.
- `reuseExistingServer` is enabled outside CI, so an already-running API/web
  server is reused.
- Tests run against Chromium and write missions/events to the E2E database.
- Install the browser once with `pnpm exec playwright install chromium`.

Do not point E2E at production infrastructure.

### ML

```bash
cd ml
uv run pytest
```

### Container (optional)

```bash
docker build -f apps/api/Dockerfile -t adaptive-learn-api:local .
```

## Local seed

Seeding certification content is a Phase 1 concern and is not present yet. The
eventual command shape is:

```bash
cargo run -p seed -- --cert aws-dop-c02
```

## Developer rule

A new quiz mechanic is not complete until it produces a normalized interaction
event usable by the learner model.
