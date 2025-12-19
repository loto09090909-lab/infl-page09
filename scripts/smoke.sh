#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:8787}"
DB_PATH="${DB_PATH:-}"

if [[ "${SMOKE_SKIP:-}" == "1" ]]; then
  echo "SMOKE_SKIP=1 set; skipping live smoke tests."
  exit 0
fi

if [[ -n "$DB_PATH" && -f "$DB_PATH" ]]; then
  echo "Applying schema migration to $DB_PATH"
  sqlite3 "$DB_PATH" < "$(dirname "$0")/../db/schema.sql"
fi

echo "Running smoke tests against $BASE"

health=$(curl -sSf "$BASE/api/health")
echo "health: $health"

signup=$(curl -sSf -X POST "$BASE/api/users/signup" \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke.user@example.com","password":"Passw0rd!"}')
echo "signup: $signup"

user_token=$(python - <<'PY'
import json,sys
data=json.load(sys.stdin)
print(data.get("token",""))
PY
<<<"$signup")

page_id=$(python - <<'PY'
import json,sys
data=json.load(sys.stdin)
print(data.get("pageId",""))
PY
<<<"$signup")

login=$(curl -sSf -X POST "$BASE/api/users/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke.user@example.com","password":"Passw0rd!"}')
echo "login: $login"

curl -sSf -H "Authorization: Bearer $user_token" "$BASE/api/user/pages" >/dev/null

curl -sSf -X POST "$BASE/api/user/pages/$page_id/private-links" \
  -H "Authorization: Bearer $user_token" \
  -H "Content-Type: application/json" \
  -d '{"maxUses":1}' >/dev/null

invite=$(curl -sSf -X POST "$BASE/api/user/pages/$page_id/invites" \
  -H "Authorization: Bearer $user_token" \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke.invitee@example.com","role":"viewer"}')
echo "invite: $invite"

invite_token=$(python - <<'PY'
import json,sys
data=json.load(sys.stdin)
print(data.get("token",""))
PY
<<<"$invite")

invitee=$(curl -sSf -X POST "$BASE/api/users/signup" \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke.invitee@example.com","password":"Passw0rd!"}')
invitee_token=$(python - <<'PY'
import json,sys
data=json.load(sys.stdin)
print(data.get("token",""))
PY
<<<"$invitee")

curl -sSf -X POST "$BASE/api/user/invites/$invite_token/accept" \
  -H "Authorization: Bearer $invitee_token" >/dev/null

curl -sSf -H "Authorization: Bearer $user_token" "$BASE/api/user/pages/$page_id/stats" >/dev/null

curl -sSf -H "Authorization: Bearer $user_token" "$BASE/api/user/pages/$page_id/contact-submissions.csv" >/dev/null || true

echo "Smoke tests completed."
