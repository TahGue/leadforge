#!/usr/bin/env bash
# LeadForge restore / restore drill (spec Phase 8: backup/restore drills).
#
#   scripts/restore.sh backups/leadforge-<stamp>.dump              # drill: restore into a scratch DB and verify
#   scripts/restore.sh backups/leadforge-<stamp>.dump --replace    # real restore into the live DB (stop web/worker/crawler first)
#
# The drill never touches the live database: it restores into "leadforge_restore_drill",
# compares row counts with the live database, and drops the scratch database.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DUMP="${1:?usage: restore.sh <dump> [--replace]}"
MODE="${2:-drill}"
DB_USER="${POSTGRES_USER:-leadforge}"
DB_NAME="${POSTGRES_DB:-leadforge}"
PSQL=(docker compose exec -T postgres psql -U "$DB_USER" -v ON_ERROR_STOP=1 -qtA)
TABLES='"Company" "Contact" "EmailAddress" "SourceEvidence" "SuppressionEntry" "AuditLog" "City" "Industry" "_prisma_migrations"'

[ -f "$DUMP" ] || { echo "no such dump: $DUMP" >&2; exit 2; }

counts() {
  local db="$1" out=""
  for t in $TABLES; do
    out+="$t=$("${PSQL[@]}" -d "$db" -c "SELECT count(*) FROM $t")\n"
  done
  printf "%b" "$out"
}

if [ "$MODE" = "--replace" ]; then
  echo "==> restoring $DUMP into LIVE database $DB_NAME"
  read -r -p "Type the database name to confirm: " answer
  [ "$answer" = "$DB_NAME" ] || { echo "aborted"; exit 1; }
  docker compose exec -T postgres pg_restore -U "$DB_USER" -d "$DB_NAME" --clean --if-exists --no-owner < "$DUMP"
  counts "$DB_NAME"
  echo "==> restored. Start the stack and run scripts/health-check.sh"
  exit 0
fi

SCRATCH="leadforge_restore_drill"
echo "==> drill: restoring $DUMP into scratch database $SCRATCH"
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $SCRATCH"
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $SCRATCH"
started=$(date +%s)
docker compose exec -T postgres pg_restore -U "$DB_USER" -d "$SCRATCH" --no-owner < "$DUMP"
elapsed=$(( $(date +%s) - started ))

restored="$(counts "$SCRATCH")"
live="$(counts "$DB_NAME")"
echo "==> row counts (restored | live)"
paste -d'|' <(printf "%s\n" "$restored") <(printf "%s\n" "$live")
postgis="$("${PSQL[@]}" -d "$SCRATCH" -c "SELECT postgis_version()")"
"${PSQL[@]}" -d postgres -c "DROP DATABASE $SCRATCH"

echo "==> restore took ${elapsed}s; PostGIS ${postgis}"
echo "==> record the result in docs/runbooks.md (restore drill log)"
