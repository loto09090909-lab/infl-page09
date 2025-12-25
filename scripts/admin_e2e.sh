#!/usr/bin/env bash
set -euo pipefail

# API 기본 주소 설정 (환경 변수가 없으면 localhost 사용)
BASE_URL="${BASE_URL:-http://127.0.0.1:8787}"

# 랜덤한 사용자 이름 및 비밀번호 생성
ADMIN_USER="e2e_admin_$(date +%s)"
ADMIN_PASS="secret_$(date +%s)"
PAGE_ID="e2e-page-$(date +%s)"

# 로깅 함수
log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] - $1"
}

# 실패 시 정리 함수
cleanup() {
  log "테스트 실패. 정리 작업을 시도합니다..."
  if [[ -n "${ADMIN_TOKEN:-}" ]]; then
    log "생성된 페이지 삭제 시도: $PAGE_ID"
    curl -sS -X DELETE "$BASE_URL/api/admin/pages/$PAGE_ID" \
      -H "Authorization: Bearer $ADMIN_TOKEN" || echo "페이지 삭제 실패 (이미 삭제되었을 수 있음)"
  fi
}

# 테스트 실패 시 cleanup 함수 실행
trap cleanup ERR

# Python을 사용하여 JSON에서 값을 추출하는 함수
get_json_value() {
  local json_input="$1"
  local key="$2"
  python -c "import json, sys; print(json.loads(sys.stdin.read()).get('$key', ''))" <<< "$json_input"
}

log "▶️ E2E 테스트 시작: Super Admin API 플로우"
log "테스트 대상 URL: $BASE_URL"
log "테스트용 관리자: $ADMIN_USER"
log "테스트용 페이지 ID: $PAGE_ID"

# 1. 슈퍼 관리자 계정 부트스트랩
log "[1/6] 슈퍼 관리자 계정 생성..."
bootstrap_response=$(curl -sS -X POST "$BASE_URL/api/admin/bootstrap" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")

if [[ -z "$bootstrap_response" ]]; then
  log "❌ 계정 생성 실패: 서버에서 응답이 없습니다."
  exit 1
fi
log "✅ 계정 생성 완료."

# 2. 슈퍼 관리자 로그인
log "[2/6] 생성된 계정으로 로그인하여 토큰 획득..."
login_response=$(curl -sS -X POST "$BASE_URL/api/admin/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")

ADMIN_TOKEN=$(get_json_value "$login_response" "token")

if [[ -z "$ADMIN_TOKEN" ]]; then
  log "❌ 로그인 실패: 토큰을 획득하지 못했습니다."
  echo "응답: $login_response"
  exit 1
fi
log "✅ 로그인 성공. 토큰 획득."

# 3. 새 페이지 생성
log "[3/6] 획득한 토큰으로 새 페이지 생성..."
create_response=$(curl -sS -o /dev/null -w \"%{http_code}\" -X POST "$BASE_URL/api/admin/pages" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"pageId\":\"$PAGE_ID\",\"adminEmail\":\"$ADMIN_USER@example.com\",\"adminPassword\":\"$ADMIN_PASS\",\"slugs\":[\"$PAGE_ID\"]}")

if [[ "$create_response" -ne 201 ]]; then
  log "❌ 페이지 생성 실패: HTTP 상태 코드가 201이 아닙니다 (실제: $create_response)."
  exit 1
fi
log "✅ 페이지 생성 성공 (HTTP 201)."

# 4. 생성된 페이지 공개적으로 확인
log "[4/6] 생성된 페이지의 공개 URL 확인..."
# Cloudflare Pages 리다이렉션을 고려하여 Location 헤더를 따라가도록 -L 옵션 추가
verify_response=$(curl -sS -L -o /dev/null -w \"%{http_code}\" "$BASE_URL/$PAGE_ID")

if [[ "$verify_response" -ne 200 ]]; then
  log "❌ 페이지 확인 실패: HTTP 상태 코드가 200이 아닙니다 (실제: $verify_response)."
  exit 1
fi
log "✅ 페이지 확인 성공 (HTTP 200)."

# 5. 페이지 삭제
log "[5/6] 생성했던 페이지 삭제..."
delete_response=$(curl -sS -o /dev/null -w \"%{http_code}\" -X DELETE "$BASE_URL/api/admin/pages/$PAGE_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN")

if [[ "$delete_response" -ne 200 ]]; then
  log "❌ 페이지 삭제 실패: HTTP 상태 코드가 200이 아닙니다 (실제: $delete_response)."
  exit 1
fi
log "✅ 페이지 삭제 성공 (HTTP 200)."

# 6. 삭제된 페이지 재확인 (404 예상)
log "[6/6] 삭제된 페이지가 404를 반환하는지 확인..."
verify_deleted_response=$(curl -sS -L -o /dev/null -w \"%{http_code}\" "$BASE_URL/$PAGE_ID")

if [[ "$verify_deleted_response" -ne 404 ]]; then
  log "❌ 삭제 확인 실패: 페이지가 여전히 존재합니다 (HTTP ${verify_deleted_response}). 404가 예상됩니다."
  exit 1
fi
log "✅ 삭제 확인 성공 (HTTP 404)."

log "🎉 E2E 테스트 성공적으로 완료."
exit 0
