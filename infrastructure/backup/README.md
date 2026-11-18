# Backup & restore

## Policy

- Nightly logical dump (`scripts/backup.sh`) with a manifest.
- Weekly full base backup + WAL archiving when production data matters.
- Offsite copy, client-side encrypted, separate key from the database host.
- Retention: 14 daily, 8 weekly, 12 monthly (configurable).

## Restore procedure

- **Drill:** `scripts/restore.sh <dump>` restores into a scratch database, compares row counts with live, and drops it.
- **Real restore:** stop web, worker and crawler, then `scripts/restore.sh <dump> --replace` (asks you to type the database name).
- The image must be `postgis/postgis` of the same major version (the dump contains PostGIS types).
- After restoring, start the stack: `migrate` applies any newer migrations. Then check `/api/v1/health`.
- Log every drill in [`docs/runbooks.md`](../../docs/runbooks.md#restore-drill-log).

## Rule

An untested backup is not a backup. A restore drill is a phase gate, not an optional chore.
