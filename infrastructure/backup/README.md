# Backup & restore

## Policy

- Nightly logical dump (`scripts/backup.sh`) with a manifest.
- Weekly full base backup + WAL archiving when production data matters (Phase 10).
- Offsite copy, client-side encrypted, separate key from the database host.
- Retention: 14 daily, 8 weekly, 12 monthly (configurable).

## Restore procedure

1. Provision a clean Postgres of the same major version.
2. `pg_restore -U <user> -d <db> --clean --if-exists <dump>`.
3. Apply Prisma migrations + `sql/` policies/partitions if the dump predates them.
4. Verify row counts against the manifest and run `scripts/health-check.sh`.
5. Record the drill outcome in `docs/quality-gates.md` (G10).

## Rule

An untested backup is not a backup. A restore drill is a phase gate, not an optional chore.
