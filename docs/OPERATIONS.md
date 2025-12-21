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
- 마이그레이션 전에도 로그인은 가능하도록 레거시 폴백이 있으나, 플랜 정책은 기본값으로 처리됩니다.
- `plan_limits` 테이블에 `max_pages` 등 컬럼이 없다면 `db/migrations/2025-fix-plan-limits-columns.sql`를 적용하세요.

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
 - 이메일 기준 삭제: `DELETE /api/users/by-email?email=sample@example.com`

## 8) TODO
- OAuth 가입/로그인 이후의 사용자 전용 대시보드 경로 확정 필요.
- 컨택트 보관 기간/자동 삭제 정책 확정 필요.
 - `/api/*` 프록시 도메인은 환경별로 분리 적용 필요(Preview/Prod).
