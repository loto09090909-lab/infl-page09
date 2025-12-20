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

## 3) OAuth 리다이렉트 설정
### Google
- 콜백 URL: `{OAUTH_REDIRECT_BASE}/api/auth/google/callback`
### Naver
- 콜백 URL: `{OAUTH_REDIRECT_BASE}/api/auth/naver/callback`

## 4) Pages 라우팅
- `public/_redirects`에서 `/api/*`가 Workers로 프록시됩니다.
- 운영 도메인이 변경되면 `/api/*` 대상 주소를 업데이트하세요.

## 5) TODO
- OAuth 가입/로그인 이후의 사용자 전용 대시보드 경로 확정 필요.
- 컨택트 보관 기간/자동 삭제 정책 확정 필요.
 - `/api/*` 프록시 도메인은 환경별로 분리 적용 필요(Preview/Prod).
