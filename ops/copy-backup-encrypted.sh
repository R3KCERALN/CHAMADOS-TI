#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
umask 077

ARCHIVE="${1:-}"
CERTIFICATE="$(setting BACKUP_ENCRYPTION_CERT_FILE)"
SIGNING_CERTIFICATE="$(setting BACKUP_SIGNING_CERT_FILE)"
SIGNING_KEY="$(setting BACKUP_SIGNING_KEY_FILE)"
DESTINATION="$(setting BACKUP_EXTERNAL_DESTINATION)"
COPY_COMMAND="$(setting BACKUP_EXTERNAL_COPY_COMMAND)"

fail() { printf 'encrypted_copy_failed reason=%s\n' "$1" >&2; exit 1; }
[[ -f "$ARCHIVE" ]] || fail archive_not_found
[[ "$CERTIFICATE" = /* && -r "$CERTIFICATE" ]] || fail certificate_not_readable
[[ "$SIGNING_CERTIFICATE" = /* && -r "$SIGNING_CERTIFICATE" ]] || fail signing_certificate_not_readable
[[ "$SIGNING_KEY" = /* && -r "$SIGNING_KEY" ]] || fail signing_key_not_readable
[[ -n "$DESTINATION" ]] || fail destination_missing
command -v openssl >/dev/null 2>&1 || fail openssl_not_found
openssl x509 -in "$CERTIFICATE" -noout >/dev/null 2>&1 || fail certificate_invalid
openssl x509 -in "$SIGNING_CERTIFICATE" -noout >/dev/null 2>&1 || fail signing_certificate_invalid
openssl pkey -in "$SIGNING_KEY" -noout >/dev/null 2>&1 || fail signing_key_invalid
private_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}
KEY_MODE="$(private_mode "$SIGNING_KEY")"
(( (8#$KEY_MODE & 077) == 0 )) || fail signing_key_permissions

STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/central-backup-copy.XXXXXX")"
trap 'rm -rf "$STAGING_DIR"' EXIT
ENCRYPTED="$STAGING_DIR/encrypted.cms"
AUTHENTICATED="$STAGING_DIR/$(basename "$ARCHIVE").cms"
VERIFIED="$STAGING_DIR/verified.cms"

openssl cms -encrypt -binary -aes256 -outform DER \
  -in "$ARCHIVE" -out "$ENCRYPTED" "$CERTIFICATE" || fail encryption_failed
[[ -s "$ENCRYPTED" ]] || fail encrypted_archive_empty
openssl cms -sign -binary -nodetach -nocerts -md sha256 -outform DER \
  -in "$ENCRYPTED" -signer "$SIGNING_CERTIFICATE" -inkey "$SIGNING_KEY" \
  -out "$AUTHENTICATED" || fail signing_failed
[[ -s "$AUTHENTICATED" ]] || fail authenticated_archive_empty
openssl cms -verify -binary -inform DER -in "$AUTHENTICATED" \
  -nointern -certfile "$SIGNING_CERTIFICATE" -noverify -out "$VERIFIED" \
  >/dev/null 2>&1 || fail signature_self_check_failed
cmp -s "$ENCRYPTED" "$VERIFIED" || fail signed_content_mismatch

if [[ -n "$COPY_COMMAND" ]]; then
  [[ "$COPY_COMMAND" = /* && -x "$COPY_COMMAND" ]] || fail copy_command_not_executable
  "$COPY_COMMAND" "$AUTHENTICATED" "$DESTINATION" || fail copy_command_failed
else
  [[ "$DESTINATION" = /* && -d "$DESTINATION" && -w "$DESTINATION" ]] || fail destination_not_writable
  TARGET="$DESTINATION/$(basename "$AUTHENTICATED")"
  [[ ! -e "$TARGET" && ! -e "$TARGET.partial" ]] || fail destination_exists
  cp "$AUTHENTICATED" "$TARGET.partial"
  chmod 600 "$TARGET.partial"
  cmp -s "$AUTHENTICATED" "$TARGET.partial" || fail copied_archive_mismatch
  mv "$TARGET.partial" "$TARGET"
fi

printf 'authenticated_encrypted_copy_complete archive=%s\n' "$(basename "$AUTHENTICATED")"
