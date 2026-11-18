#!/usr/bin/env bash
# LeadForge backup — Postgres logical dump (custom format) + optional MinIO mirror.
# Restore procedure: docs/architecture.md §5 and infrastructure/backup/README.md
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DB_USER="${POSTGRES_USER:-leadforge}"
DB_NAME="${POSTGRES_DB:-leadforge}"

mkdir -p "$BACKUP_DIR"
out="$BACKUP_DIR/leadforge-${STAMP}.dump"

echo "==> dumping ${DB_NAME}"
docker compose exec -T postgres pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc --no-owner > "$out"
echo "    $(du -h "$out" | cut -f1)  $out"

# manifest: what this backup contains and how to restore it
cat > "$BACKUP_DIR/leadforge-${STAMP}.manifest" <<MANIFEST
created_at_utc=${STAMP}
database=${DB_NAME}
format=pg_dump custom (Fc)
restore=pg_restore -U ${DB_USER} -d ${DB_NAME} --clean --if-exists ${out##*/}
postgres_image=$(docker compose images --format json 2>/dev/null | grep -o '"postgres[^}]*}' | head -1 || echo unknown)
MANIFEST

# prune old backups (never touch the manifest of a kept dump)
find "$BACKUP_DIR" -type f \( -name 'leadforge-*.dump' -o -name 'leadforge-*.manifest' \) \
  -mtime +"$RETENTION_DAYS" -print -delete

echo "==> retention: ${RETENTION_DAYS} days"
echo "==> done"
