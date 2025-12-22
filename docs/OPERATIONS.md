# 운영 설정 가이드 (Cloudflare Pages + Workers)

## 1) 필수 시크릿/환경변수

### Workers Secrets (wrangler secret)
- `TOKEN_SECRET` 또는 `SESSION_SECRET`
  - 로그인 세션 서명에 사용됩니다.
- `OAUTH_GOOGLE_CLIENT_ID`
- `OAUTH_GOOGLE_CLIENT_SECRET`
- `OAUTH_NAVER_CLIENT_ID`
- `OAUTH_NAVER_CLIENT_SECRET`
- `TURNSTILE_SECRET` (선택)
  - 설정 시 컨택트 폼에서 Turnstile 검증이 활성화됩니다.

### Workers Vars (wrangler.toml 또는 대시보드)
- `ALLOWED_ORIGINS`
  - CORS 허용 도메인 목록(쉼표 구분).
- `OAUTH_REDIRECT_BASE`
  - 예: `https://infl-worker.example.workers.dev`
  - OAuth 콜백 URL을 생성할 때 사용됩니다.
- `CONTACT_THROTTLE_WINDOW_MS` (선택)
- `CONTACT_THROTTLE_MAX` (선택)
- `CONTACT_RETENTION_DAYS` (선택)

### Pages Config (public/config.js)
- `turnstileSiteKey`
  - Turnstile 위젯을 노출할 때 사용합니다.

## 2) D1/KV 바인딩
- `worker/wrangler.toml`의 `DB`(D1), `PAGE_KV`(KV) 바인딩이 필요합니다.
- `database_name` 값이 실제 D1 이름과 일치해야 합니다.
- 기존 D1에 `plan_id` 컬럼이 없다면 `db/migrations/2025-add-plan-id-to-users.sql` 마이그레이션을 적용하세요.

## 2-1) 플랜 정책 (free/basic/premium)

| 플랜 | 페이지 생성 | 슬러그 변경 | 프라이빗 링크 | 최대 페이지 | 최대 프라이빗 링크 | 최대 컨택트 필드 | CSV 내보내기 | 통계 보관 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| free | 가능 | 불가 | 불가 | 1 | 3 | 5 | 불가 | 7일 |
| basic | 가능 | 가능 | 가능 | 3 | 10 | 15 | 가능 | 30일 |
| premium | 가능 | 가능 | 가능 | 10 | 50 | 50 | 가능 | 365일 |

## 3) OAuth 리다이렉트 설정
### Google
- 콜백 URL: `{OAUTH_REDIRECT_BASE}/api/auth/google/callback`
### Naver
- 콜백 URL: `{OAUTH_REDIRECT_BASE}/api/auth/naver/callback`

## 4) Pages 라우팅
- `public/_redirects`에서 `/api/*`가 Workers로 프록시됩니다.
- 운영 도메인이 변경되면 `/api/*` 대상 주소를 업데이트하세요.

## 5) 배포 명령어
- 환경별 배포 시 `--env` 플래그를 명시하세요.
  - 예: `npx wrangler deploy --env production`

## 6) 슈퍼 관리자 계정 초기화
- `TOKEN_SECRET` 또는 `SESSION_SECRET` 설정 후 `/api/admin/bootstrap`을 호출하세요.
- 요청 바디 예시:
  ```json
  { "username": "admin", "password": "원하는비밀번호" }
  ```
- 첫 계정은 누구나 생성 가능하며, 이후에는 슈퍼 관리자 토큰이 필요합니다.

## 7) 테스트 계정 정리
- 슈퍼 관리자 토큰으로 테스트 계정을 삭제할 수 있습니다.
- 요청 예시: `DELETE /api/users/{userId}` (Authorization: Bearer <super token>)

## 8) TODO
- OAuth 가입/로그인 이후의 사용자 전용 대시보드 경로 확정 필요.
- 컨택트 보관 기간/자동 삭제 정책 확정 필요.
 - `/api/*` 프록시 도메인은 환경별로 분리 적용 필요(Preview/Prod).

## 9) 알림 채널 확장 (선택)
- 운영 알림/컨택트 제출 알림을 전송할 때 아래 환경 변수를 사용할 수 있습니다.
- `OPS_WEBHOOK_URL` : 운영 알림용 일반 웹훅 (JSON POST)
- `OPS_SLACK_WEBHOOK_URL` : 운영 알림용 슬랙 Incoming Webhook
- `OPS_EMAIL_WEBHOOK_URL` : 이메일 연동 웹훅 (SendGrid 등)
- `OPS_EMAIL_TO` : 이메일 수신 주소
