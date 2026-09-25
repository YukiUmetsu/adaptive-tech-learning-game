# Adaptive Technical Learning Game

Working documentation for a certification-focused learning game for cloud, AI, Linux, security, math, and IT knowledge.

## Product thesis

The app chooses what the learner should study next, explains why, and lets the learner override the plan. Learning sessions are short, tactile, and game-like. Study history is used to predict what the learner is likely to forget.

Primary loop:

```mermaid
flowchart LR
    G[Certification goal] --> P[Adaptive study plan]
    P --> M[2-10 minute mission]
    M --> Q[Interactive retrieval puzzles]
    Q --> F[Immediate feedback]
    F --> K[Update knowledge state]
    K --> R[Earn game resources]
    R --> W[Build / explore / companion / gacha]
    W --> P
```

## Initial product scope

- Certification campaigns: AWS, Azure, Google Cloud, Linux Foundation, security, AI.
- Passwordless login plus Google social login.
- Adaptive study plan based on exam date, objective weights, mastery, and forgetting risk.
- Quiz mechanics: node connection, ordering, reconstruction, equation assembly, classification, 2D sorting, troubleshooting, and boss battles.
- Game economy: earned currency, exploration energy, building, anime companion, cosmetics, and earned gacha.
- Local-first session execution. Backend is used for sync, authoritative economy, account state, and model distribution.
- No per-question LLM calls.

## Selected stack

| Layer | Decision | Main reason |
|---|---|---|
| Web | React + TypeScript + Vite/PWA | Fast UI iteration; good drag/canvas ecosystem; mobile-friendly |
| Web hosting | Cloudflare static assets | Static requests are free/unlimited |
| API | Rust + Axum + Tokio | Native Rust, efficient, portable container |
| DB client | SQLx | Async; compile-time checked SQL; no heavy ORM |
| API hosting | Google Cloud Run | Scale-to-zero; container portability; generous free tier |
| Auth | WorkOS AuthKit | Google OAuth + passwordless Magic Auth; first 1M MAU free |
| Relational DB | Neon Postgres | Postgres portability; scale-to-zero; usage-based pricing |
| Object/event store | Cloudflare R2 | Cheap storage; S3 API; zero internet egress |
| Analytics | Parquet + DuckDB locally; Iceberg + R2 SQL later if needed | Avoid an expensive analytics service early |
| ML training | Local first; Modal; RunPod later | $0 initial training; cheap burst GPU later |

## Current implementation status

- **Phase 0** — repository foundation, Rust/Axum API, React/Vite/PWA shell, PostgreSQL + SQLx, OpenAPI → TypeScript generation.
- **Phase 1 (in progress)** — a pre-quiz **Knowledge Map** discovery layer plus a growing certification catalog with real, original content: AWS SOA-C03 (all five domains), AWS SAA-C03, AWS AIP-C01, Microsoft AZ-900 (all three domains), Microsoft AZ-104 (all five domains), CompTIA Security+ SY0-701 (all five domains), HashiCorp Terraform Associate 004, and AI/Python tracks (Python fluency, Python data stack, PyTorch core). The web app has a category-grouped catalog, a game-style certification dashboard, three learner-facing quiz modes (Quick Quiz, Domain Quiz, Full Practice) with server-side question selection, a full set of tactile interaction types, a server-authoritative **Bits** currency, and a free `/demo` for every interaction type. A browser-only **Cyber Defense** tower game (`/game`) adds a short, data-driven security-defense mission set with local progress. WorkOS AuthKit sign-in is implemented end to end. Adaptive scheduling, mastery prediction, and the persistent game world are not built yet.

## Getting started

Repository layout and full commands are in
[Local development](docs/11-local-development.md). The short version:

```bash
# Local PostgreSQL
docker compose up -d

# API (applies migrations locally)
cp .env.example .env
cargo run -p adaptive-learn-api

# Web
cd apps/web
pnpm install
cp .env.example .env.local
pnpm dev
```

Checks:

```bash
cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test
(cd apps/web && pnpm lint && pnpm typecheck && pnpm test && pnpm build)
(cd apps/web && E2E_DATABASE_URL=postgres://app:app@localhost:5432/app pnpm e2e)
(cd ml && uv run pytest)
```

## Documentation

1. [Product and problem statement](docs/01-product.md)
2. [System architecture](docs/02-system-architecture.md)
3. [Data and storage architecture](docs/03-data-storage.md)
4. [Platform and cost analysis](docs/04-platform-costs.md)
5. [Authentication](docs/05-authentication.md)
6. [Learning engine](docs/06-learning-engine.md)
7. [Gamification](docs/07-gamification.md)
8. [Certification content](docs/08-certification-content.md)
9. [ML training and model lifecycle](docs/09-ml-training-and-model-lifecycle.md)
10. [Implementation plan](docs/10-implementation-plan.md)
11. [Local development](docs/11-local-development.md)
12. [Deployment](docs/12-deployment.md)
13. [Scaling plan](docs/13-scaling.md)
14. [Security and privacy](docs/14-security-privacy.md)
15. [Review](docs/15-review.md)
16. [AI security instructions](docs/17-AI-security-instructions.md)
17. [Cyber Defense game specification](docs/18-cyber-defense-game-spec.md)
18. [References](docs/REFERENCES.md)

## Design rules

- Optimize for **return frequency and useful retrieval**, not question count.
- Recognition and recall are separate evidence.
- The app chooses the default plan; the learner can see the reason and change it.
- Economic state is server-authoritative.
- Learning interaction can continue offline; economic rewards remain pending until authoritative reconciliation.
- Raw historical events belong in cheap object storage, not indefinitely in the transactional database.
- Do not introduce infrastructure merely because it is theoretically more scalable.
