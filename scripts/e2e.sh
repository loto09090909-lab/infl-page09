#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:8787}"

if [[ -z "${TOKEN_SECRET:-}" && -z "${SESSION_SECRET:-}" ]]; then
  echo "TOKEN_SECRET 또는 SESSION_SECRET이 필요합니다."
  exit 1
fi

echo "Running E2E smoke flow against $BASE"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/smoke.sh"

echo "E2E smoke flow completed."
