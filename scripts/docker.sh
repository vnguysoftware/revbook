#!/usr/bin/env bash
set -euo pipefail

# ─── RevBack Docker Script ──────────────────────────────────────────────────
# Usage:
#   ./scripts/docker.sh           Dev mode (hot reload, debug ports)
#   ./scripts/docker.sh prod      Production mode
#   ./scripts/docker.sh down      Stop all containers
#   ./scripts/docker.sh logs      Tail container logs

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[docker]${NC} $*"; }
err() { echo -e "${RED}[docker]${NC} $*" >&2; }

# Check docker is available
if ! command -v docker &>/dev/null; then
  err "Docker is not installed or not in PATH"
  exit 1
fi

case "${1:-}" in
  ""|dev)
    log "Starting RevBack in dev mode (with hot reload)..."
    docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
    ;;

  prod)
    log "Starting RevBack in production mode..."
    docker compose up --build -d
    echo ""
    log "Services running:"
    log "  App:       ${CYAN}http://localhost:3000${NC}"
    log "  Dashboard: ${CYAN}http://localhost:80${NC}"
    log ""
    log "Use './scripts/docker.sh logs' to tail logs."
    ;;

  down)
    log "Stopping all containers..."
    docker compose down
    log "All containers stopped."
    ;;

  logs)
    docker compose logs -f --tail=100
    ;;

  *)
    err "Unknown command: $1"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  (none)   Dev mode with hot reload"
    echo "  prod     Production mode (detached)"
    echo "  down     Stop all containers"
    echo "  logs     Tail container logs"
    exit 1
    ;;
esac
