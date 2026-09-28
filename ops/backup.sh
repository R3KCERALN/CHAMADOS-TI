#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
umask 077
STAGE="configuration"
ARCHIVE="not-created"
on_error() {
  local status="$?" alert
  trap - ERR
  set +e
  printf 'backup_failed status=%s stage=%s archive=%s\n' "$status" "$STAGE" "$ARCHIVE" >&2
  alert="$(setting BACKUP_FAILURE_HOOK)"
  if [[ -n "$alert" ]]; then
    if [[ ! -x "$alert" ]]; then
      printf 'backup_failure_alert_failed reason=hook_not_executable\n' >&2
    elif ! "$alert" backup_failed "$STAGE" "$ARCHIVE"; then
      printf 'backup_failure_alert_failed reason=hook_exit_nonzero\n' >&2
    else
      printf 'backup_failure_alert_sent\n' >&2
    fi
  fi
  exit "$status"
}
trap on_error ERR
RETENTION="$(setting BACKUP_RETENTION_DAYS)"
RETENTION="${RETENTION:-14}"
[[ "$RETENTION" =~ ^[1-9][0-9]*$ ]] || { echo 'Invalid retention days' >&2; false; }
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups/$PROJECT}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
ARCHIVE="$BACKUP_DIR/central_$(date -u +%Y%m%dT%H%M%SZ)_$$.dump"
trap 'rm -f "$ARCHIVE.partial"' EXIT
STAGE="database_dump"
compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=6 --no-owner --no-privileges' > "$ARCHIVE.partial"
STAGE="archive_validation"
compose exec -T db pg_restore --list < "$ARCHIVE.partial" > /dev/null
mv "$ARCHIVE.partial" "$ARCHIVE"
HOOK="$(setting BACKUP_COPY_HOOK)"
if [[ -n "$HOOK" ]]; then
  STAGE="external_copy"
  [[ "$HOOK" = /* && -x "$HOOK" ]] || { echo 'Backup copy hook must be an absolute executable path' >&2; false; }
  "$HOOK" "$ARCHIVE"
fi
# Retain old copies when dump or external copy fails.
STAGE="local_retention"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'central_*.dump' -mtime "+$RETENTION" -delete
STAGE="complete"
printf 'Backup complete: %s\n' "$ARCHIVE"
