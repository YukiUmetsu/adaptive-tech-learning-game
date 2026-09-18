# Local Development

## Prerequisites

- Rust stable
- `cargo`
- Node.js LTS
- `pnpm`
- Docker / Docker Compose
- Python 3.12+
- `uv`
- `sqlx-cli`

Example:

```bash
cargo install sqlx-cli --no-default-features --features rustls,postgres
```

## Local services

Use Docker only for infrastructure:

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

Use a filesystem/minio-style test adapter for object storage only if required. Do not make local development depend on R2.

## Environment

Example `.env`:

```text
DATABASE_URL=postgres://app:app@localhost:5432/app

WORKOS_CLIENT_ID=
WORKOS_API_KEY=

R2_ENDPOINT=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=

API_BASE_URL=http://localhost:8080
WEB_BASE_URL=http://localhost:5173
```

Never commit production secrets.

## Start

```bash
docker compose up -d

# API
cd apps/api
sqlx migrate run
cargo run

# Web
cd apps/web
pnpm install
pnpm dev
```

## ML environment

```bash
cd ml
uv sync
uv run pytest
uv run python -m src.train
```

Early training may read local exported JSONL/Parquet.

## Tests

### Rust

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

### Web

```bash
pnpm lint
pnpm test
pnpm build
```

### ML

```bash
uv run pytest
```

## Local seed

Provide:

```bash
cargo run -p seed -- --cert aws-dop-c02
```

Seed should create:

- certification/version
- objective graph
- concept graph
- sample questions
- sample test user state

## Developer rule

A new quiz mechanic is not complete until it produces a normalized interaction event usable by the learner model.
