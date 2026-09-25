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
infra/       infrastructure notes; the web app is hosted on Cloudflare (see apps/web/wrangler.jsonc)
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

## Phase 1 learning MVP

Phase 1 ships real, multi-certification content:

- AWS Certified CloudOps Engineer - Associate (`aws-soa-c03`, `SOA-C03`): all
  five domains, each with authored tasks and questions.
- AWS Certified Solutions Architect - Associate (`aws-saa-c03`) and AWS
  Certified Generative AI Developer - Professional (`aws-aip-c01`).
- CompTIA Security+ (`comptia-security-plus`, `SY0-701`): all five domains.
- HashiCorp Certified: Terraform Associate (`hashicorp-terraform-associate-004`).
- AI tracks: Python fluency, Python data stack (NumPy/pandas/Matplotlib/Seaborn),
  and PyTorch core.

Each certification also has learning knowledge maps for pre-quiz discovery;
AWS SOA-C03, CompTIA Security+, and the AI tracks are fully covered, and
Terraform covers all eight domains. The web catalog and dashboard read
certification metadata from `apps/web/src/state/catalogMeta.ts` plus the API
catalog.

Content is authored as versioned JSON organized as
`content/<category>/<certification>/<version>/<file>.json`. The content crate
discovers and embeds every JSON file under `content/` at build time (see
`crates/content/build.rs`), so adding or splitting content requires no code
change. Each file is independently validated at startup and rejected if concept
references, canonical answers, weights, identifiers, or versions are invalid.

Multiple files may declare the same certification version (for example one file
per exam domain): the registry merges them into one logical bundle. Concepts,
questions, and tasks are keyed by id, with later files overriding earlier
definitions, so a newer file can expand or rewrite a task without duplicating
it. Authored content versions are preserved per file, and a mission is issued
against the content version that owns the task it covers.

Canonical answers are never sent with a mission; they are returned only after
an answer is scored.

A separate `content/demo/` bundle holds original SOA-C03 demo questions that
exercise every interaction type. It is intentionally kept out of the primary
certification bundle so demo content can change without touching real authored
content. The web app's `/demo` route surfaces that bundle and starts its
missions without an account; it is linked from the primary navigation and the
home page. The API `/health` endpoint remains for operations, but the former web
status page has been removed.

Key API endpoints:

```text
GET  /v1/certifications
GET  /v1/certifications/{certification_id}/domains/{domain_id}/learning
POST /v1/missions/issue          # mode: quick_adaptive | domain_quiz | section_quiz | full_practice | task_practice
POST /v1/missions/{mission_id}/answers
POST /v1/missions/{mission_id}/complete
POST /v1/sync
GET  /v1/wallet?device_id=...
GET  /v1/me
```

`GET /v1/certifications` also returns each version's domains, tasks, and
learner-facing concept names, so the shared end-of-quiz completion summary can
show friendly knowledge labels without ever rendering a raw concept id such as
`aws.cloudformation.changesets`.

Learners see four quiz modes (Quick Quiz, Domain Quiz, Section Quiz, Full
Practice) from the certification dashboard; the server selects questions per
mode and settles Bits on sync. A Section Quiz is started from a completed
learning module on the knowledge map and returns to that section afterwards. The
web routes are `/certifications` (category catalog) and
`/certifications/:certificationId` (dashboard). `task_practice` and the
`/certifications/:certificationId/tasks/:taskId` route remain for the demo and
internal debugging.

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
- **Identity.** Requests carry a client-generated `device_id` as device/install
  context, but ownership is derived from the verified WorkOS subject, not from
  the device id. The local `dev:<subject>` bearer mode is available only when
  the API runs with `APP_ENV=local`/`test`; staging and production require WorkOS
  and there is no production bypass.
- **Mission expiry.** `expires_at` is issued and stored but not enforced.
- **Storage.** Progress uses `localStorage`. If storage is unavailable the
  runner surfaces a warning rather than silently losing evidence; synced events
  are removed from the pending queue.
- **Content scope.** Authored questions now span all SOA-C03 domains plus SAA-C03,
  AIP-C01, Terraform Associate 004, and the AI/Python tracks. The equation
  interaction is still not implemented.
- **Auth session persistence.** With the default `api.workos.com` host the
  refresh token is stored in `localStorage` (`devMode`); a custom AuthKit
  authentication domain gives first-party cookie persistence instead. See
  [Authentication](05-authentication.md).

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

For staging/production Neon — including the direct (non-pooled) connection
string, apply/inspect/rollback commands, and the `RUN_MIGRATIONS` guidance — see
`docs/12-deployment.md`.

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
| `WORKOS_ISSUER` | expected token issuer | optional; set for a custom AuthKit domain |
| `WORKOS_JWKS_URL` | JWKS override | optional; e.g. `/oauth2/jwks` for a custom AuthKit domain |
| `R2_*` | Cloudflare R2 | unused so far |
| `VITE_API_PROXY_TARGET` | dev/preview proxy target for `/v1` and `/health` | `apps/web/.env.local`; defaults to `http://localhost:8080` |
| `VITE_API_BASE_URL` | web → API origin | set only when the API is on a different origin than the web app |
| `VITE_WORKOS_CLIENT_ID` | web WorkOS client id | enables the AuthKit sign-in UI |
| `VITE_WORKOS_API_HOSTNAME` | custom AuthKit authentication domain | optional; leave empty for `api.workos.com` |
| `VITE_ASSET_BASE_URL` | public origin for R2 game media | optional; no trailing slash |
| `VITE_AUTH_DEV_MODE` | opt into the local dev identity in a non-dev build | never enable in production |

Authentication is enforced on the API by default; WorkOS values are validated at
startup and staging/production require them. See
[Authentication](05-authentication.md).

## ML environment

```bash
cd ml
uv sync
uv run pytest
```

There is no training entrypoint yet. HLR/FSRS/DAS3H work begins in a later
phase.

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

### Code review (OpenCodeReview)

[OpenCodeReview](https://github.com/alibaba/open-code-review) is an optional
AI review assistant for the [OpenCode](https://opencode.ai) agent. The `ocr`
CLI is a global tool, installed outside the repository:

```bash
npm install -g @alibaba-group/open-code-review   # provides the `ocr` binary
```

The integration is versioned under `.opencode/`:

- `.opencode/plugins/open-code-review.ts` — the OpenCode plugin. It registers
  the `ocr_review` / `ocr_health` tools and the `/ocr-review` / `/ocr-health`
  commands.
- `.opencode/skills/open-code-review-delegate/SKILL.md` — delegation mode, where
  OpenCode itself performs the review.

Two ways to run a review:

1. **Delegation mode (no OCR model or API key).** Ask OpenCode to use the
   `open-code-review-delegate` skill. `ocr` only selects files and resolves
   rules (`ocr delegate preview`, `ocr delegate rule <paths>`); OpenCode's own
   model writes the findings.
2. **OCR-managed mode (needs an LLM).** Configure OCR once, then use the
   `ocr_review` tool or `/ocr-review`:

   ```bash
   ocr config provider
   ocr config model
   ocr llm test
   ```

   `ocr_review` accepts `preview: true` to list the files that would be
   reviewed without spending tokens.

> **Vendored plugin note.** Upstream `open-code-review.ts` is a dual V1/V2 plugin
> that imports `@opencode-ai/plugin` at its top level. The compiled OpenCode
> binary cannot resolve packages from `.opencode/node_modules`, so that import
> breaks plugin loading. This copy keeps only the V2 entrypoint, which needs no
> runtime packages. Do not add package imports to the plugin without bundling
> them into a single file. Re-fetch and re-trim from upstream when updating.

Global OpenCode also loads plugins from `~/.config/opencode/plugins/`, but the
project copy keeps the integration reproducible for everyone in the repository.

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
