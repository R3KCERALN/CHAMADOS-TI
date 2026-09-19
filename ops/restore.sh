#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
ARCHIVE="${1:-}"
TARGET="${2:-}"
CONFIRM="${3:-}"
[[ -f "$ARCHIVE" && "$TARGET" =~ ^central_restore_[a-z0-9_]+$ && ${#TARGET} -le 63 ]] || {
  echo 'Usage: restore.sh archive.dump central_restore_NAME RESTORE:project:database' >&2; exit 1;
}
[[ "$CONFIRM" == "RESTORE:$PROJECT:$TARGET" && "$TARGET" != "$(setting POSTGRES_DB)" ]] || {
  echo 'Restore confirmation mismatch or target is the running database' >&2; exit 1;
}
compose exec -T db pg_restore --list < "$ARCHIVE" > /dev/null
# createdb fails if the target already exists. Never use --clean, --create or DROP.
compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" createdb -h 127.0.0.1 -U "$POSTGRES_USER" -- "$1"' sh "$TARGET"
compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -h 127.0.0.1 -U "$POSTGRES_USER" --dbname="$1" --exit-on-error --single-transaction --no-owner --no-privileges' sh "$TARGET" < "$ARCHIVE"
# Prevent resurrected login sessions or pending alerts after recovery. Business history stays intact.
compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$1" -v ON_ERROR_STOP=1' sh "$TARGET" <<'SQL'
BEGIN;
DELETE FROM "Session";
UPDATE "PushSubscription" SET active = false;
UPDATE "PushDelivery" SET status = 'CANCELLED', "finishedAt" = NOW(), "leaseToken" = NULL WHERE status = 'PENDING';
COMMIT;
SQL
printf 'Restored into %s only. Verify, grant app access and change POSTGRES_DB explicitly before promotion.\n' "$TARGET"
