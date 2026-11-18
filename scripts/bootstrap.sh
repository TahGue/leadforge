#!/usr/bin/env bash
# LeadForge bootstrap — verify toolchain, prepare env, start infrastructure.
# Idempotent: safe to run repeatedly.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1"; }

say "checking toolchain"
need docker
need git
docker compose version >/dev/null 2>&1 || die "docker compose plugin not available"
say "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo 'not running')"

command -v node >/dev/null 2>&1 && say "node $(node --version)" || warn "node not found (needed from Phase 1)"
command -v pnpm >/dev/null 2>&1 && say "pnpm $(pnpm --version)" || warn "pnpm not found (needed from Phase 1)"
command -v python3 >/dev/null 2>&1 && say "python $(python3 --version)" || warn "python3 not found (needed from Phase 0)"

if [[ ! -f .env ]]; then
  say "creating .env from template"
  cp .env.example .env
  # generate a session secret so the default stack is not trivially forgeable
  if command -v openssl >/dev/null 2>&1; then
    secret="$(openssl rand -base64 48 | tr -d '\n')"
    if [[ "$(uname -s)" == "Darwin" ]]; then
      sed -i '' "s|^SESSION_SECRET=.*|SESSION_SECRET=${secret}|" .env
    else
      sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=${secret}|" .env
    fi
  else
    warn "openssl missing — set SESSION_SECRET in .env manually"
  fi
else
  say ".env already exists (left untouched)"
fi

say "starting postgres + redis"
docker compose up -d

say "waiting for healthchecks"
for _ in $(seq 1 30); do
  unhealthy="$(docker compose ps --format json 2>/dev/null | grep -c '"Health":"starting"' || true)"
  [[ "$unhealthy" == "0" ]] && break
  sleep 2
done

docker compose ps

say "verifying postgres"
for _ in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-leadforge}" -d "${POSTGRES_DB:-leadforge}" >/dev/null 2>&1; then
    say "postgres ready"
    break
  fi
  sleep 2
done

say "verifying redis"
docker compose exec -T redis redis-cli ping | grep -q PONG && say "redis ready"

if command -v python3 >/dev/null 2>&1 && command -v uv >/dev/null 2>&1; then
  say "syncing python environment"
  uv sync
else
  warn "uv not installed — skipping python sync (pip install uv)"
fi

cat <<'EOF'

Bootstrap complete.

  docker compose ps          # stack status
  docker compose logs -f     # follow logs
  ./scripts/health-check.sh  # verify everything

Next: Phase 1 scaffolds apps/web and packages/database.
EOF
