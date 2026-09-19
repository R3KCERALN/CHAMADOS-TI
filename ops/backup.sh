#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
umask 077
RETENTION="$(setting BACKUP_RETENTION_DAYS)"
RETENTION="${RETENTION:-14}"
[[ "$RETENTION" =~ ^[1-9][0-9]*$ ]] || { echo 'Invalid retention days' >&2; exit 1; }
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups/$PROJECT}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
ARCHIVE="$BACKUP_DIR/central_$(date -u +%Y%m%dT%H%M%SZ)_$$.dump"
trap 'rm -f "$ARCHIVE.partial"' EXIT
compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=6 --no-owner --no-privileges' > "$ARCHIVE.partial"
compose exec -T db pg_restore --list < "$ARCHIVE.partial" > /dev/null
mv "$ARCHIVE.partial" "$ARCHIVE"
HOOK="$(setting BACKUP_COPY_HOOK)"
if [[ -n "$HOOK" ]]; then
  [[ -x "$HOOK" ]] || { echo 'Backup copy hook must be executable' >&2; exit 1; }
  "$HOOK" "$ARCHIVE"
fi
# Retain old copies when dump or external copy fails.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'central_*.dump' -mtime "+$RETENTION" -delete
printf 'Backup complete: %s\n' "$ARCHIVE"
