#!/usr/bin/env bash
#
# Deploy the API to Cloud Run, after applying pending migrations to Neon.
#
# Order of operations (see docs/12-deployment.md):
#   migrate Neon -> build image -> deploy compatible API -> smoke test
#
# Migrations run against a Neon connection string supplied by the operator. The
# direct (non-pooled) host is recommended, because the pooled host runs
# PgBouncer in transaction mode and is not ideal for DDL or the migrator's
# advisory lock; a pooled URL is accepted but warned about. The Cloud Run service
# keeps using the pooled URL from Secret Manager, and RUN_MIGRATIONS stays false
# so no cold start migrates.
#
# Usage:
#   NEON_DIRECT_DATABASE_URL='postgresql://USER:PASSWORD@ep-xxxx.<region>.aws.neon.tech/neondb?sslmode=require' \
#     infra/deploy.sh
#
# Every value below can be overridden with an environment variable, for example:
#   REGION=us-central1 SERVICE=adaptive-learning-api-staging infra/deploy.sh
#
# Useful toggles:
#   SKIP_BUILD=1       reuse the image already tagged with the current git SHA
#   SKIP_MIGRATIONS=1  do not touch the database (no NEON_DIRECT_DATABASE_URL needed)
#   SKIP_SMOKE=1       skip the post-deploy /health check

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (overridable)
# ---------------------------------------------------------------------------
PROJECT_ID="${PROJECT_ID:-recallspire}"
REGION="${REGION:-us-east4}"
SERVICE="${SERVICE:-adaptive-learning-api}"
ARTIFACT_REPO="${ARTIFACT_REPO:-adaptive-learning}"
IMAGE_NAME="${IMAGE_NAME:-api}"

APP_ENV="${APP_ENV:-staging}"
LOG_FORMAT="${LOG_FORMAT:-json}"
MIN_INSTANCES="${MIN_INSTANCES:-0}"
MAX_INSTANCES="${MAX_INSTANCES:-1}"
CONCURRENCY="${CONCURRENCY:-40}"
CPU="${CPU:-1}"
MEMORY="${MEMORY:-512Mi}"
TIMEOUT="${TIMEOUT:-300}"
BUILD_PLATFORM="${BUILD_PLATFORM:-linux/amd64}"
DATABASE_MAX_CONNECTIONS="${DATABASE_MAX_CONNECTIONS:-5}"
CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-https://learn.shidenlabs.com}"
WORKOS_CLIENT_ID="${WORKOS_CLIENT_ID:-client_01M2W23D1YFK9EXKZR9CXXQN69}"

SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-${SERVICE}@${PROJECT_ID}.iam.gserviceaccount.com}"
DATABASE_URL_SECRET="${DATABASE_URL_SECRET:-adaptive-learning-database-url}"
WORKOS_API_KEY_SECRET="${WORKOS_API_KEY_SECRET:-adaptive-learning-workos-api-key}"

# Direct, non-pooled Neon URL used only for migrations. Never deployed.
NEON_DIRECT_DATABASE_URL="${NEON_DIRECT_DATABASE_URL:-}"

SKIP_BUILD="${SKIP_BUILD:-0}"
SKIP_MIGRATIONS="${SKIP_MIGRATIONS:-0}"
SKIP_SMOKE="${SKIP_SMOKE:-0}"

# ---------------------------------------------------------------------------
# Derived values
# ---------------------------------------------------------------------------
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="${ROOT_DIR}/crates/db/migrations"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPO}/${IMAGE_NAME}"
HEALTH_PATH="/health"
# gcloud's --set-env-vars treats "," as the pair separator, so an origin list
# like "https://a,https://b" would be split. Use an explicit delimiter instead.
ENV_DELIM="@"
SECRETS="DATABASE_URL=${DATABASE_URL_SECRET}:latest,WORKOS_API_KEY=${WORKOS_API_KEY_SECRET}:latest"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
cd "$ROOT_DIR"

[ -f "${ROOT_DIR}/apps/api/Dockerfile" ] || die "apps/api/Dockerfile not found; run from the repository"

require_cmd git
[ "$SKIP_BUILD" = "1" ] || require_cmd docker
if [ "$SKIP_MIGRATIONS" != "1" ]; then
  require_cmd sqlx
fi
require_cmd gcloud
[ "$SKIP_SMOKE" = "1" ] || require_cmd curl

gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | grep -q . \
  || die "no active gcloud account; run 'gcloud auth login'"

if [ "$SKIP_MIGRATIONS" != "1" ]; then
  [ -n "$NEON_DIRECT_DATABASE_URL" ] \
    || die "NEON_DIRECT_DATABASE_URL is required for migrations, or set SKIP_MIGRATIONS=1"
  case "$NEON_DIRECT_DATABASE_URL" in
    *-pooler*)
      warn "NEON_DIRECT_DATABASE_URL looks pooled ('-pooler' in host). Neon's pooler runs PgBouncer in transaction mode, where DDL and the migrator's advisory lock can misbehave; the direct host is preferred. Continuing because a pooled URL was provided."
      ;;
  esac
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  warn "working tree has uncommitted changes; the image will not match a commit exactly"
fi

# ---------------------------------------------------------------------------
# Image tag from the current commit
# ---------------------------------------------------------------------------
GIT_SHA="$(git rev-parse --short HEAD)"
TAG="$GIT_SHA"
if ! git diff --quiet || ! git diff --cached --quiet; then
  TAG="${GIT_SHA}-dirty-$(date +%Y%m%d%H%M%S)"
fi

# ---------------------------------------------------------------------------
# 1. Apply pending migrations to Neon
# ---------------------------------------------------------------------------
if [ "$SKIP_MIGRATIONS" = "1" ]; then
  log "Skipping migrations (SKIP_MIGRATIONS=1)"
else
  log "Checking pending migrations against Neon"
  DATABASE_URL="$NEON_DIRECT_DATABASE_URL" sqlx migrate info --source "$MIGRATIONS_DIR"

  log "Applying migrations to Neon"
  DATABASE_URL="$NEON_DIRECT_DATABASE_URL" sqlx migrate run --source "$MIGRATIONS_DIR"
fi

# ---------------------------------------------------------------------------
# 2. Build and push an immutable image
# ---------------------------------------------------------------------------
if [ "$SKIP_BUILD" = "1" ]; then
  log "Skipping build; reusing ${IMAGE}:${TAG}"
else
  log "Building ${IMAGE}:${TAG} for ${BUILD_PLATFORM}"
  # Cloud Run requires amd64/linux. On Apple Silicon the default is arm64, and
  # BuildKit's default provenance attestation wraps the push in an OCI image
  # index that Cloud Run rejects, so pin the platform and disable provenance.
  if docker buildx version >/dev/null 2>&1; then
    docker buildx build \
      --platform "$BUILD_PLATFORM" \
      --provenance=false \
      --load \
      -f apps/api/Dockerfile \
      -t "${IMAGE}:${TAG}" .
  else
    docker build --platform "$BUILD_PLATFORM" -f apps/api/Dockerfile -t "${IMAGE}:${TAG}" .
  fi

  log "Authenticating Docker to ${REGION}-docker.pkg.dev"
  gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

  log "Pushing ${IMAGE}:${TAG}"
  docker push "${IMAGE}:${TAG}"
fi

DIGEST="$(gcloud artifacts docker images describe "${IMAGE}:${TAG}" \
  --project "$PROJECT_ID" \
  --format='value(image_summary.digest)' 2>/dev/null || true)"
[ -n "$DIGEST" ] || die "could not resolve an image digest for ${IMAGE}:${TAG}; was the image pushed?"
IMAGE_DIGEST="${IMAGE}@${DIGEST}"
log "Resolved immutable image ${IMAGE_DIGEST}"

# ---------------------------------------------------------------------------
# 3. Deploy the image to Cloud Run
# ---------------------------------------------------------------------------
log "Deploying ${SERVICE} (${REGION})"
gcloud run deploy "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --image "$IMAGE_DIGEST" \
  --service-account "$SERVICE_ACCOUNT" \
  --allow-unauthenticated \
  --port 8080 \
  --min-instances "$MIN_INSTANCES" \
  --max-instances "$MAX_INSTANCES" \
  --concurrency "$CONCURRENCY" \
  --cpu "$CPU" \
  --memory "$MEMORY" \
  --timeout "$TIMEOUT" \
  --set-env-vars "^${ENV_DELIM}^APP_ENV=${APP_ENV}${ENV_DELIM}LOG_FORMAT=${LOG_FORMAT}${ENV_DELIM}RUN_MIGRATIONS=false${ENV_DELIM}DATABASE_MAX_CONNECTIONS=${DATABASE_MAX_CONNECTIONS}${ENV_DELIM}WORKOS_CLIENT_ID=${WORKOS_CLIENT_ID}${ENV_DELIM}CORS_ALLOWED_ORIGINS=${CORS_ALLOWED_ORIGINS}" \
  --set-secrets "$SECRETS" \
  --quiet

# ---------------------------------------------------------------------------
# 4. Smoke test
# ---------------------------------------------------------------------------
SERVICE_URL="$(gcloud run services describe "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format='value(status.url)')"

if [ "$SKIP_SMOKE" = "1" ]; then
  log "Skipping smoke test (SKIP_SMOKE=1). Service URL: ${SERVICE_URL}"
else
  log "Smoke testing ${SERVICE_URL}${HEALTH_PATH}"
  healthy=0
  for _ in $(seq 1 12); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "${SERVICE_URL}${HEALTH_PATH}" || true)"
    if [ "$code" = "200" ]; then
      healthy=1
      break
    fi
    sleep 5
  done
  [ "$healthy" = "1" ] || die "health check did not return 200 for ${SERVICE_URL}${HEALTH_PATH}"
  log "Health check passed"
fi

log "Done: ${SERVICE_URL} (${IMAGE_DIGEST})"
