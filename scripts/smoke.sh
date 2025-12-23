#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:8787}"
DB_PATH="${DB_PATH:-}"
TOKEN_SECRET="${TOKEN_SECRET:-}"
SESSION_SECRET="${SESSION_SECRET:-}"
SUPER_TOKEN="${SUPER_TOKEN:-}"

if [[ "${SMOKE_SKIP:-}" == "1" ]]; then
  echo "SMOKE_SKIP=1 set; skipping live smoke tests."
  exit 0
fi

if [[ -z "$TOKEN_SECRET" && -z "$SESSION_SECRET" ]]; then
  echo "TOKEN_SECRET 또는 SESSION_SECRET이 필요합니다."
  exit 1
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

curl -sSf -H "Authorization: Bearer $user_token" "$BASE/api/user/pages/$page_id/plan-status" >/dev/null

page_admin_login=$(curl -sSf -X POST "$BASE/api/page/$page_id/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"smoke.user@example.com\",\"password\":\"Passw0rd!\"}")
echo "page_admin_login: $page_admin_login"

page_admin_token=$(python - <<'PY'
import json,sys
data=json.load(sys.stdin)
print(data.get("token",""))
PY
<<<"$page_admin_login")

curl -sSf -H "Authorization: Bearer $page_admin_token" "$BASE/api/page/$page_id/plan-status" >/dev/null

save_payload=$(cat <<EOF
{
  "profile": { "name": "Smoke User", "description": "Smoke test", "photoUrl": "" },
  "links": [],
  "privateLinks": [],
  "contactSchema": [
    { "label": "이메일", "type": "email", "required": true, "placeholder": "user@example.com" }
  ],
  "contactSettings": { "enabled": true, "consentText": "개인정보 수집에 동의합니다.", "consentRequired": true },
  "slugs": ["$page_id"],
  "plan": "free",
  "theme": "classic"
}
EOF
)

curl -sSf -X POST "$BASE/api/page/$page_id/save" \
  -H "Authorization: Bearer $page_admin_token" \
  -H "Content-Type: application/json" \
  -d "$save_payload" >/dev/null

contact_payload=$(cat <<EOF
{
  "answers": [{ "label": "이메일", "value": "smoke.user@example.com" }],
  "consentChecked": true
}
EOF
)

curl -sSf -X POST "$BASE/api/pages/$page_id/contact" \
  -H "Content-Type: application/json" \
  -d "$contact_payload" >/dev/null

template=$(curl -sSf -X POST "$BASE/api/page/$page_id/private-templates" \
  -H "Authorization: Bearer $page_admin_token" \
  -H "Content-Type: application/json" \
  -d '{"name":"smoke-template","payload":{"maxUses":1,"note":"smoke"}}')
echo "template: $template"

template_id=$(python - <<'PY'
import json,sys
data=json.load(sys.stdin)
print(data.get("id",""))
PY
<<<"$template")

issue=$(curl -sSf -X POST "$BASE/api/page/$page_id/private-templates/$template_id/links" \
  -H "Authorization: Bearer $page_admin_token")
echo "issue: $issue"

curl -sSf -X DELETE "$BASE/api/user/pages/$page_id/contact-submissions" \
  -H "Authorization: Bearer $user_token" >/dev/null

if [[ -n "${OAUTH_GOOGLE_CLIENT_ID:-}" || -n "${OAUTH_NAVER_CLIENT_ID:-}" ]]; then
  echo "OAuth start endpoint check"
  curl -sS -I "$BASE/api/auth/google/start" | head -n 1 || true
fi

echo "Smoke tests completed."
