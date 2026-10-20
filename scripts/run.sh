#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 {dev|prod}"
  echo "  dev   Start Docker Redis, use existing local MySQL, generate/migrate Prisma, and hot reload."
  echo "  prod  Build, confirm production migrations, prune dependencies, and start."
  echo "Run from Bash (Git Bash or WSL on Windows). Env files must use Bash-compatible KEY='value' syntax."
}
fail() { echo "Error: $*" >&2; exit 1; }

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  dev) mode=development ;;
  prod) mode=production ;;
  *) usage >&2; exit 1 ;;
esac
[[ $# -eq 1 ]] || { usage >&2; exit 1; }

BACKEND_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BACKEND_DIR"
ENV_FILE="$BACKEND_DIR/.env.$mode"
[[ -f "$ENV_FILE" ]] || fail "Missing .env.$mode in backend. Copy .env.example and configure it first."
command -v node >/dev/null 2>&1 || fail "Node.js is required (use the Node 24 version used by the Dockerfile)."
command -v npm >/dev/null 2>&1 || fail "npm is required."

# Production preserves injected secrets; dev explicitly selects the mode file.
# Bash's export output is shell-quoted; never echo it or enable shell tracing.
INJECTED_ENV="$(export -p)"
if [[ "$mode" == development ]]; then unset DATABASE_URL REDIS_URL; fi
set -a
if ! source "$ENV_FILE" >/dev/null 2>&1; then
  fail "Could not source .env.$mode. Use KEY='value' assignments; quote passwords and URLs."
fi
set +a
if [[ "$mode" == production ]]; then eval "$INJECTED_ENV"; fi
unset INJECTED_ENV
export NODE_ENV="$mode"

if [[ "$mode" == development ]]; then
  command -v docker >/dev/null 2>&1 || fail "Docker is required for local Redis. Install Docker Desktop or Docker Engine."
  docker info >/dev/null 2>&1 || fail "Docker is not running or is inaccessible. Start Docker and retry."
fi

if [[ "$mode" == production || ! -d node_modules || ! -f node_modules/tsx/package.json || ! -f node_modules/prisma/package.json || ! -f node_modules/typescript/package.json ]]; then
  node scripts/check-dependency-locks.mjs
  echo "Installing locked dependencies (including tools needed to generate and build)..."
  npm ci --include=dev
fi

# Validate and show the selected database without credentials before any work.
node --input-type=module --import tsx -e '
  import { env } from "./src/config/env.ts";
  import { targetSummary } from "./scripts/prisma.mjs";
  console.log("Database target: " + JSON.stringify(targetSummary(
    env.NODE_ENV === "production" ? "prod" : "dev", env, `.env.${env.NODE_ENV}`,
  )));
'

if [[ "$mode" == development ]]; then
  # Use the existing local MySQL installation; Docker supplies only Redis.
  node --input-type=module --import tsx -e '
    import { env } from "./src/config/env.ts";
    const redis = new URL(env.REDIS_URL);
    if (redis.protocol !== "redis:" || !["localhost", "127.0.0.1"].includes(redis.hostname) || (redis.port && redis.port !== "6379") || redis.username || redis.password) {
      console.error("Error: dev launcher requires unauthenticated local REDIS_URL=redis://127.0.0.1:6379.");
      process.exit(1);
    }
  '
  REDIS_CONTAINER=serviceflow-dev-redis
  echo "Starting local Redis (6379)..."
  if docker container inspect "$REDIS_CONTAINER" >/dev/null 2>&1; then
    [[ "$(docker inspect --format '{{ index .Config.Labels "com.serviceflow.dev-redis" }}' "$REDIS_CONTAINER")" == true ]] || fail "Container $REDIS_CONTAINER already exists and was not created by this launcher. Rename it or use another Redis setup."
    docker start "$REDIS_CONTAINER" >/dev/null
  else
    docker run -d --name "$REDIS_CONTAINER" \
      --label com.serviceflow.dev-redis=true \
      --restart unless-stopped \
      -p 127.0.0.1:6379:6379 \
      -v serviceflow-dev-redis-data:/data \
      --health-cmd 'redis-cli ping' --health-interval 5s --health-timeout 3s --health-retries 20 \
      redis:7-alpine redis-server --appendonly yes >/dev/null
  fi
  redis_ready=false
  for ((attempt=0; attempt<30; attempt++)); do
    if docker exec "$REDIS_CONTAINER" redis-cli ping >/dev/null 2>&1; then
      redis_ready=true
      break
    fi
    sleep 1
  done
  [[ "$redis_ready" == true ]] || fail "Redis did not become ready. Check docker logs $REDIS_CONTAINER and whether port 6379 is available."
  # This launcher already sourced and validated the selected environment.
  node node_modules/prisma/build/index.js generate
  node node_modules/prisma/build/index.js migrate dev
  exec npm run dev
fi

node node_modules/prisma/build/index.js generate
npm run build
echo "This will apply pending migrations to the configured PRODUCTION database."
read -r -p 'Type production to continue: ' confirmation || fail "Production confirmation is required."
[[ "$confirmation" == production ]] || fail "Production migrations cancelled."
node node_modules/prisma/build/index.js migrate deploy
echo "Keeping production runtime dependencies..."
npm prune --omit=dev --omit=peer --omit=optional --ignore-scripts
exec npm start
