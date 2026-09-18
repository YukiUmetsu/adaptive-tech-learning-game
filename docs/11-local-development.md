# Local Development

## Repository layout

```text
apps/
  api/       Rust + Axum API (library + binary + OpenAPI export)
  web/       React + TypeScript + Vite PWA
crates/
  domain/    core types and invariants
  db/        PostgreSQL pool, SQLx migrations, persistence
ml/          Python 3.12 + uv evaluation utilities (no model yet)
infra/       deployment documentation only; nothing is deployed
docs/        architecture and design documents
```

`crates/economy`, `crates/planner`, `crates/sync`, and `content/` are
intentionally absent in Phase 0. Add them when they have a concrete purpose.

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

If port 5432 is already in use, set `POSTGRES_PORT` when starting Docker and
update `DATABASE_URL` to match:

```bash
POSTGRES_PORT=55432 docker compose up -d
DATABASE_URL=postgres://app:app@localhost:55432/app cargo run -p adaptive-learn-api
```

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
| `VITE_API_BASE_URL` | web → API origin | `apps/web/.env.local` |

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
