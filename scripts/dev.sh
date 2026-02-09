#!/usr/bin/env bash
set -euo pipefail

# ─── RevBack Dev Script ─────────────────────────────────────────────────────
# Usage:
#   ./scripts/dev.sh              Start full stack (DB, Redis, backend, frontend)
#   ./scripts/dev.sh stop         Stop background services (Postgres, Redis)
#   ./scripts/dev.sh backend      Start backend only (assumes DB/Redis running)
#   ./scripts/dev.sh frontend     Start frontend only
#   ./scripts/dev.sh db           Start Postgres + Redis only
#   ./scripts/dev.sh landing      Serve the landing page
#   ./scripts/dev.sh seed         Seed demo data
#   ./scripts/dev.sh migrate      Run database migrations
#   ./scripts/dev.sh reset        Reset DB + migrate + seed

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log()  { echo -e "${GREEN}[revback]${NC} $*"; }
warn() { echo -e "${YELLOW}[revback]${NC} $*"; }
err()  { echo -e "${RED}[revback]${NC} $*" >&2; }

# ─── Helpers ─────────────────────────────────────────────────────────────────

check_deps() {
  local missing=()
  for cmd in "$@"; do
    if ! command -v "$cmd" &>/dev/null; then
      missing+=("$cmd")
    fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    err "Missing required commands: ${missing[*]}"
    exit 1
  fi
}

wait_for_port() {
  local port=$1 name=$2 timeout=${3:-30}
  local elapsed=0
  while ! nc -z localhost "$port" 2>/dev/null; do
    sleep 1
    elapsed=$((elapsed + 1))
    if [[ $elapsed -ge $timeout ]]; then
      err "$name did not start within ${timeout}s on port $port"
      return 1
    fi
  done
  log "$name ready on port $port"
}

# ─── DB (Postgres + Redis via docker compose) ───────────────────────────────

start_db() {
  check_deps docker
  log "Starting Postgres and Redis..."
  docker compose up -d postgres redis
  wait_for_port 5432 "Postgres"
  wait_for_port 6379 "Redis"
}

stop_db() {
  check_deps docker
  log "Stopping Postgres and Redis..."
  docker compose down
  log "Services stopped."
}

# ─── Backend ─────────────────────────────────────────────────────────────────

start_backend() {
  check_deps node npm
  log "Starting backend (tsx watch)..."
  npx tsx watch src/index.ts
}

# ─── Frontend ────────────────────────────────────────────────────────────────

start_frontend() {
  check_deps node npm
  log "Starting dashboard (Vite dev server)..."
  cd "$ROOT/dashboard"
  npm run dev
}

# ─── Landing Page ────────────────────────────────────────────────────────────

start_landing() {
  local landing_file="$ROOT/dashboard/dist/landing.html"
  if [[ ! -f "$landing_file" ]]; then
    err "Landing page not found at $landing_file"
    err "Build the dashboard first: cd dashboard && npm run build"
    exit 1
  fi

  local port=4000
  log "Serving landing page at ${CYAN}http://localhost:${port}/landing.html${NC}"
  log "Press Ctrl+C to stop."

  # Use Python's built-in HTTP server (available on macOS/Linux)
  if command -v python3 &>/dev/null; then
    cd "$ROOT/dashboard/dist"
    python3 -m http.server "$port"
  elif command -v npx &>/dev/null; then
    npx -y serve "$ROOT/dashboard/dist" -l "$port"
  else
    err "Need python3 or npx to serve static files"
    exit 1
  fi
}

# ─── Database Operations ────────────────────────────────────────────────────

run_migrate() {
  check_deps node npm
  log "Running database migrations..."
  npx tsx src/config/migrate.ts
  log "Migrations complete."
}

run_seed() {
  check_deps node npm
  log "Seeding database..."
  npx tsx scripts/seed.ts
  log "Seed complete."
}

run_reset() {
  check_deps docker node npm
  warn "This will drop and recreate the database!"
  read -r -p "Continue? [y/N] " confirm
  if [[ "$confirm" != [yY] ]]; then
    log "Aborted."
    exit 0
  fi

  log "Resetting database..."
  docker compose exec -T postgres psql -U revback -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" revback
  run_migrate
  run_seed
  log "Database reset complete."
}

# ─── Full Stack ──────────────────────────────────────────────────────────────

PIDS=()

cleanup() {
  echo ""
  log "Shutting down..."
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
  log "All processes stopped. (DB/Redis still running — use './scripts/dev.sh stop' to stop them)"
}

start_all() {
  trap cleanup EXIT INT TERM

  # Start DB services
  start_db

  # Start backend in background
  log "Starting backend..."
  npx tsx watch src/index.ts &
  PIDS+=($!)

  # Give backend a moment to boot
  sleep 2

  # Start frontend in background
  log "Starting dashboard..."
  cd "$ROOT/dashboard"
  npm run dev &
  PIDS+=($!)
  cd "$ROOT"

  echo ""
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log "  RevBack dev stack is running!"
  log ""
  log "  Backend:   ${CYAN}http://localhost:3000${NC}"
  log "  Dashboard: ${CYAN}http://localhost:5173${NC}"
  log "  Postgres:  localhost:5432"
  log "  Redis:     localhost:6379"
  log ""
  log "  Press Ctrl+C to stop all processes."
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # Wait for all background processes
  wait
}

# ─── Main ────────────────────────────────────────────────────────────────────

case "${1:-}" in
  ""|all)     start_all ;;
  stop)       stop_db ;;
  backend)    start_backend ;;
  frontend)   start_frontend ;;
  db)         start_db ;;
  landing)    start_landing ;;
  seed)       run_seed ;;
  migrate)    run_migrate ;;
  reset)      run_reset ;;
  *)
    err "Unknown command: $1"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  (none)     Start full stack (DB, Redis, backend, frontend)"
    echo "  stop       Stop Postgres and Redis containers"
    echo "  backend    Start backend only"
    echo "  frontend   Start frontend only"
    echo "  db         Start Postgres + Redis only"
    echo "  landing    Serve the landing page"
    echo "  seed       Seed demo data"
    echo "  migrate    Run database migrations"
    echo "  reset      Drop DB, re-migrate, and re-seed"
    exit 1
    ;;
esac
