#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
compose config --quiet
compose build --pull app migrate
compose up -d --wait db
# A completed service is recreated on every release; failed migrations block app startup.
compose up --no-deps --force-recreate --exit-code-from migrate migrate
compose up -d --wait --wait-timeout 180 app proxy
echo 'Deployment healthy. Bootstrap is explicit; no seed was executed.'
