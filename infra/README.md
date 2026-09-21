# Infrastructure

Infrastructure notes for the project. **The web frontend is deployed to
Cloudflare; the API, database, and object storage are not, and no
Terraform/OpenTofu resources are committed.** Add infrastructure as code when a
real environment is provisioned, not for completeness.

Selected providers and their role are defined in `docs/04-platform-costs.md` and
`docs/12-deployment.md`.

| Component | Provider | Status |
|---|---|---|
| Web assets | Cloudflare (Worker static assets) | `apps/web/wrangler.jsonc`; deploys from `main` |
| API container | Google Cloud Run | Dockerfile at `apps/api/Dockerfile`; not deployed |
| PostgreSQL | Neon | local Docker Postgres only |
| Object storage | Cloudflare R2 | not used; documented for game media (`app-assets`), raw telemetry, training data, models |

## API container

Build from the repository root:

```bash
docker build -f apps/api/Dockerfile -t adaptive-learn-api:local .
docker run --rm -p 8080:8080 \
  -e DATABASE_URL=postgres://app:app@host.docker.internal:5432/app \
  -e RUN_MIGRATIONS=true \
  adaptive-learn-api:local
```

The image is portable to any OCI host. Deployment must use an immutable image
digest.

## When infrastructure is added

Follow the deployment document rather than inventing resources here:

- Cloud Run: min instances `0`, concurrency `20-80`, max instances `5-10`.
- Region: benchmark Cloud Run ↔ Neon latency before choosing; do not hardcode.
- Secrets: provider secret stores only; never bake into images or static assets.
- Database migrations: run as an approved job, not implicitly on every deploy.
- R2 buckets/prefixes: `app-assets`, `learning-events`, `training-data`, `models`.

## Not present (intentionally)

- Kubernetes
- Redis or another cache
- Message queues
- Committed cloud credentials
