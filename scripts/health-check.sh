#!/usr/bin/env bash
# LeadForge health check — container health + dependency reachability.
# Exit code 0 only when every required check passes.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail=0
ok()   { printf '\033[1;32m  ok\033[0m   %s\n' "$*"; }
bad()  { printf '\033[1;31m  FAIL\033[0m %s\n' "$*"; fail=1; }
skip() { printf '\033[1;33m  skip\033[0m %s\n' "$*"; }

echo "containers"
for svc in postgres redis; do
  id="$(docker compose ps -q "$svc" 2>/dev/null || true)"
  if [[ -z "$id" ]]; then bad "$svc not created"; continue; fi
  state="$(docker inspect -f '{{.State.Status}}' "$id" 2>/dev/null || echo unknown)"
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null || echo unknown)"
  if [[ "$state" == "running" && ( "$health" == "healthy" || "$health" == "none" ) ]]; then
    ok "$svc ($state/$health)"
  else
    bad "$svc ($state/$health)"
  fi
done

echo "dependencies"
if docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-leadforge}" -d "${POSTGRES_DB:-leadforge}" >/dev/null 2>&1; then
  ok "postgres accepts connections"
else
  bad "postgres not accepting connections"
fi

if [[ "$(docker compose exec -T redis redis-cli ping 2>/dev/null | tr -d '\r')" == "PONG" ]]; then
  ok "redis responds to PING"
else
  bad "redis not responding"
fi

echo "application"
if curl -fsS --max-time 3 "http://localhost:3000/api/v1/health" >/dev/null 2>&1; then
  ok "web /api/v1/health"
else
  skip "web not running yet (expected before Phase 1)"
fi

[[ $fail -eq 0 ]] && echo "all required checks passed" || echo "one or more checks failed"
exit $fail
