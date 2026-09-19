#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PRODUCTION_ENV_FILE:-$ROOT/.env.production}"
[[ -f "$ENV_FILE" ]] || { echo 'Production env file not found' >&2; exit 1; }
# Never source an env file as shell code. Compose parses it; scripts read only non-secret settings.
setting() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 | tr -d '\r'; }
PROJECT="$(setting COMPOSE_PROJECT_NAME)"
[[ "$PROJECT" =~ ^central-suporte-prod(-[a-z0-9-]+)?$ ]] || { echo 'Expected a dedicated central-suporte-prod project' >&2; exit 1; }
compose() { docker compose --env-file "$ENV_FILE" -p "$PROJECT" -f "$ROOT/compose.production.yaml" "$@"; }
