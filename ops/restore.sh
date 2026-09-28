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
RESTORE_ARCHIVE="$ARCHIVE"
TEMP_DIR=""
cleanup() { [[ -z "$TEMP_DIR" ]] || rm -rf "$TEMP_DIR"; }
trap cleanup EXIT
if [[ "$ARCHIVE" == *.cms ]]; then
  SIGNING_CERTIFICATE="$(setting BACKUP_SIGNING_CERT_FILE)"
  CERTIFICATE="$(setting BACKUP_DECRYPTION_CERT_FILE)"
  PRIVATE_KEY="$(setting BACKUP_DECRYPTION_KEY_FILE)"
  [[ "$SIGNING_CERTIFICATE" = /* && -r "$SIGNING_CERTIFICATE" && \
    "$CERTIFICATE" = /* && -r "$CERTIFICATE" && "$PRIVATE_KEY" = /* && -r "$PRIVATE_KEY" ]] || {
    echo 'Encrypted restore requires readable absolute signing, decryption-certificate and private-key paths' >&2; exit 1;
  }
  private_mode() {
    stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
  }
  KEY_MODE="$(private_mode "$PRIVATE_KEY")"
  (( (8#$KEY_MODE & 077) == 0 )) || { echo 'Backup private key must not be accessible by group or others' >&2; exit 1; }
  command -v openssl >/dev/null 2>&1 || { echo 'OpenSSL is required for encrypted restore' >&2; exit 1; }
  openssl x509 -in "$SIGNING_CERTIFICATE" -noout >/dev/null 2>&1 || {
    echo 'Backup signing certificate is invalid' >&2; exit 1;
  }
  TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/central-backup-restore.XXXXXX")"
  chmod 700 "$TEMP_DIR"
  VERIFIED_ENCRYPTED="$TEMP_DIR/encrypted.cms"
  RESTORE_ARCHIVE="$TEMP_DIR/backup.dump"
  openssl cms -verify -binary -inform DER -in "$ARCHIVE" \
    -nointern -certfile "$SIGNING_CERTIFICATE" -noverify -out "$VERIFIED_ENCRYPTED" \
    >/dev/null 2>&1 || {
      echo 'Encrypted backup signature is missing or invalid' >&2; exit 1;
    }
  [[ -s "$VERIFIED_ENCRYPTED" ]] || { echo 'Verified encrypted backup is empty' >&2; exit 1; }
  openssl cms -decrypt -binary -inform DER -in "$VERIFIED_ENCRYPTED" \
    -recip "$CERTIFICATE" -inkey "$PRIVATE_KEY" -out "$RESTORE_ARCHIVE" || {
      echo 'Encrypted backup could not be decrypted' >&2; exit 1;
    }
  [[ -s "$RESTORE_ARCHIVE" ]] || { echo 'Decrypted backup is empty' >&2; exit 1; }
fi
compose exec -T db pg_restore --list < "$RESTORE_ARCHIVE" > /dev/null
# createdb fails if the target already exists. Never use --clean, --create or DROP.
compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" createdb -h 127.0.0.1 -U "$POSTGRES_USER" -- "$1"' sh "$TARGET"
compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -h 127.0.0.1 -U "$POSTGRES_USER" --dbname="$1" --exit-on-error --single-transaction --no-owner --no-privileges' sh "$TARGET" < "$RESTORE_ARCHIVE"
# Prevent resurrected login sessions or pending alerts after recovery. Business history stays intact.
compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$1" -v ON_ERROR_STOP=1' sh "$TARGET" <<'SQL'
BEGIN;
DELETE FROM "Session";
UPDATE "PushSubscription" SET active = false;
UPDATE "PushDelivery" SET status = 'CANCELLED', "finishedAt" = NOW(), "leaseToken" = NULL WHERE status = 'PENDING';
COMMIT;
SQL
printf 'Restored into %s only. Verify, grant app access and change POSTGRES_DB explicitly before promotion.\n' "$TARGET"
