# 시스템 점검 결과

## 1. 구현 및 동작 개요
- **백엔드 라우팅**: Cloudflare Worker가 공개 페이지 조회(`/api/pages/:pageId`), 슈퍼 관리자 로그인 및 페이지 CRUD(`/api/admin/*`), 페이지 관리자 로그인/저장(`/api/page/:pageId/*`)을 처리합니다. CORS는 `ALLOWED_ORIGINS` 환경변수를 기반으로 설정하며, 인증 토큰은 `TOKEN_SECRET` HMAC 서명을 검증하거나 과거 KV UUID 세션을 호환 확인합니다.【F:worker/index.ts†L13-L90】【F:worker/auth.ts†L4-L93】【F:worker/auth.ts†L95-L152】
- **슈퍼 관리자**: D1 `super_admin` 테이블의 PBKDF2 또는 기존 SHA-256 해시를 검증해 서명 토큰을 발급하며, 페이지 생성·목록·삭제·수정 시 KV와 D1(`page_auth`, `page_meta`)을 모두 갱신합니다.【F:worker/super-admin.ts†L21-L169】【F:worker/super-admin.ts†L301-L376】
- **페이지 관리자**: D1(`page_admins`)의 관리자와 사용자 인증 정보를 비교해 서명 토큰을 발급하고, 페이지 데이터 저장 시 KV와 `page_meta`를 덮어씁니다.【F:worker/page-admin.ts†L1-L105】【F:worker/page-admin.ts†L195-L286】
- **페이지 조회**: 우선 D1 `page_meta`를 조회하고 없을 경우 KV `page:{pageId}`를 반환합니다. JSON 파싱 실패 시 500 오류를 보냅니다.【F:worker/page-view.ts†L1-L46】
- **컨택트 제출/조회**: 공개 페이지에서 `contactSchema` 기반 폼을 제출하면 `/api/pages/:pageId/contact`가 IP별 제출 횟수를 제한하며 KV에 저장하고, 설정된 웹훅으로 페이로드를 전달합니다. 페이지 관리자는 목록 조회와 CSV 다운로드를 지원합니다.【F:worker/contact.ts†L1-L214】【F:public/js/script.js†L420-L520】【F:public/js/script.js†L1400-L1465】
- **프런트엔드 흐름**: 공통 스크립트가 하드코딩된 워커 도메인으로 API를 호출하며, 사용자 페이지일 때만 데이터 요청을 수행합니다. 슈퍼/페이지 관리자 로그인은 세션 토큰을 `sessionStorage`에 저장해 이후 요청에 사용하며, 페이지 관리자 로그인 폼은 URL의 pageId를 자동 채웁니다.【F:public/js/script.js†L1-L226】
- **슈퍼 관리자 UI**: 별도 스크립트로 페이지 생성·목록·삭제·편집을 수행하고, 토큰이 없으면 로그인 페이지로 리다이렉트합니다.【F:public/js/suscript.js†L1-L123】

## 2. 주요 문제점
- **레거시 해시 호환 부담**: 새 계정은 PBKDF2(SHA-256, 120k iteration, salt)로 저장하지만, 기존 SHA-256 해시도 로그인 시 허용돼 잔존 위험이 남습니다. 운영 단계에서 순차적으로 PBKDF2로 재발급/교체해야 합니다.【F:worker/users.ts†L19-L117】【F:worker/super-admin.ts†L301-L376】
- **프런트/백 계약 불일치 및 하드코딩된 도메인**: `API_BASE`가 코드에 고정돼 환경별 분리가 불가능하며, 프런트 단의 저장/링크 추가 함수는 백엔드 라우트에 존재하지 않는 `/api/pages/save` 등을 호출합니다(데드 코드).【F:public/js/script.js†L1-L60】
- **입력 검증 부재**: 요청 본문에 대한 스키마 검증이나 길이 제한이 없어 D1/KV에 임의 구조나 대형 페이로드가 저장될 수 있습니다. 에러 응답도 필드 단위 피드백이 없습니다.【F:worker/super-admin.ts†L50-L159】【F:worker/page-admin.ts†L37-L59】
- **권한 경계 및 로깅 부족**: 페이지 저장 엔드포인트가 페이지 관리자 전용으로만 존재하고, 슈퍼 관리자의 페이지 수정/삭제와 동일 권한 분리가 부족합니다. 감사 로그, 실패 횟수 제한, IP 기반 레이트리밋이 없습니다.【F:worker/index.ts†L39-L87】【F:worker/super-admin.ts†L50-L159】
- **UX/라우팅 빈틈**: `/admin.html` 등 관리 화면의 기본 폼 필드가 실제 백엔드 스키마와 다르고(예: 비밀번호만 요구), 페이지 ID/토큰 검증 실패 시 구체적 안내가 부족합니다. 또한 `/page/{id}/admin` 라우팅을 명시적으로 처리하는 정적 자산이 없어 SEO/리다이렉트 문제 가능성이 있습니다.【F:public/js/script.js†L119-L226】

## 3. 개선 및 추가 제안
1) **인증 강화 및 세션 보안**
   - 비밀번호를 Argon2/Bcrypt 해시로 저장하고, 로그인 시 해시 검증을 수행하세요.
   - KV 세션 대신 JWT(HMAC) 또는 서명된 세션 토큰을 사용하고, `aud/role/subject` 클레임을 확인하며 재발급/로그아웃 API를 추가하십시오.
   - 슈퍼/페이지 관리자 로그인에 브루트포스 방지(시도 횟수 제한, IP 기반 Rate Limit)와 2FA/OTP 옵션을 도입하세요.

2) **API 계약 정리와 환경 분리**
   - `API_BASE`를 `.env`/빌드 타임 변수를 통해 주입하고, 환경별(개발/스테이징/프로덕션) 값으로 분리하세요.
   - 프런트 스크립트에서 존재하지 않는 엔드포인트 호출을 제거하거나 실제 REST 경로(`/api/admin/pages`, `/api/page/:id/save`)와 맞춰 리팩터링하십시오.
   - 페이지 관리자 라우팅을 `/[slug]/admin` 정적 페이지와 연결해 SPA 라우터 또는 리다이렉트 규칙을 마련하세요.

3) **입력 검증 및 데이터 무결성**
   - Zod/Valibot 등으로 `pageId`, `profile`, `links`, `plan`에 대한 스키마를 정의하고, 유효성 실패 시 400 응답을 표준화합니다.
   - 요청 본문 크기 제한, 허용 링크 수/URL 패턴 검증, 설명/이름 길이 제한을 적용하세요.
   - D1/KV 간 데이터 정합성을 위한 주기적 동기화/마이그레이션 작업(백업/복구 플로우 포함)을 추가하십시오.

4) **권한 및 운영 가시성**
   - 페이지 저장/수정/삭제 API에 역할 기반 접근 제어(RBAC)를 명확히 분리하고, 감사 로그(D1 또는 Logpush)로 누가 언제 어떤 변경을 했는지 기록하세요.
   - CORS를 필요한 도메인 화이트리스트로 축소하고, 프리플라이트 캐시/노출 헤더를 최소화하십시오.
   - 관리자 UI에서 토큰 만료 시 재로그인 유도, 에러 메시지 현지화 및 상태 배너 표시 등을 추가해 UX를 개선하세요.

5) **배포 및 관측성**
   - Cloudflare Pages와 Workers 간 도메인/경로 매핑을 문서화하고, 헬스체크 엔드포인트 및 알림(에러 비율/레이트 리밋 초과)을 설정하세요.
   - Sentry/Workers Trace 등 오류 추적을 붙여 500/401/404 발생 시점을 관찰하고, KV/D1 쿼리 실패 시 재시도 또는 폴백 전략을 마련하십시오.

위 항목을 적용하면 로그인/관리 플로우의 안정성과 보안을 높이고, 환경별 라우팅/데이터 무결성 문제를 예방할 수 있습니다.

## 4. 최근 미동작 원인 분석
- **슬러그 라우팅과 Pages 규칙 충돌 가능성**: `_redirects`가 단일 세그먼트 슬러그(`/:slug`)를 `user.html`로 리라이트하지만, 최하단 `/* /index.html 200!`가 여전히 존재해 캐시나 우선순위 문제 시 인덱스로 포워딩될 여지가 있습니다. `user.html`이 제공되더라도 API 요청이 404/405/네트워크 오류이면 화면이 기본 템플릿으로 남을 수 있습니다.【F:public/_redirects†L1-L18】【F:public/js/script.js†L1-L76】
- **페이지 데이터 미존재/슬러그 매핑 누락**: 사용자 페이지는 URL 세그먼트를 그대로 `GET /api/pages/:pageId`에 전달해 KV/D1에서 페이지 메타를 조회합니다. `slug_map`에 별칭이 없거나 `page_meta`/`page:{id}`가 비어 있으면 404로 끝나고 템플릿이 채워지지 않습니다.【F:public/js/script.js†L39-L73】【F:worker/page-view.ts†L10-L44】
- **API BASE 불일치 시도**: 프런트는 `meta api-base` → 고정 워커 도메인 → pages.dev 유추 → 현재 오리진 순으로 순회합니다. 실제 배포 도메인이 이 목록과 다르면 모든 베이스가 실패해 데이터가 비어 보일 수 있습니다.【F:public/js/script.js†L1-L38】

## 5. 단기 해결 가이드
1) `_redirects`에서 최종 `/* /index.html 200!`를 제거하거나 주석으로 남기고, 로컬/스테이징에서 슬러그 호출이 항상 `user.html`을 반환하는지 점검합니다.
2) Cloudflare Pages 캐시를 무효화한 뒤, `curl -I https://<도메인>/<slug>`로 응답 헤더의 리디렉션/리라이트 여부를 확인하고 200이 `user.html`인지 검사합니다.
3) 슈퍼 관리자 생성 API가 `slug_map`과 `page_meta`를 모두 채웠는지 D1 콘솔에서 `SELECT * FROM slug_map WHERE display_name='<slug>'`로 검증하고, 없다면 재저장/수동 삽입합니다.【F:worker/super-admin.ts†L21-L169】
4) `user.html`에서 `window.location.pathname`이 원하는 슬러그로 인식되는지 콘솔에서 `pathSegments` 값을 확인해 전역 `API_BASES`가 올바른지 함께 로깅합니다.【F:public/js/script.js†L48-L79】

## 6. 향후 추가 개발 제안 (슬러그/라우팅 중심)
- **서버사이드 렌더링/HTML 프리패치**: `Pages Functions`나 Worker에서 슬러그 요청 시 `user.html`을 불러와 KV/D1 데이터를 주입한 뒤 반환하면, 클라이언트 JS 실패 시에도 완성된 HTML이 노출됩니다.
- **라우트·도메인 검증 자동화**: 헬스체크 스크립트로 모든 슬러그(또는 샘플) 경로에 대해 200/콘텐츠 서명 여부를 배포 직후 검증하고 실패 시 알림하도록 CI를 구성합니다.
- **슬러그 예약어·중복 관리**: `slug_map`에 고유 제약을 적용하고, 관리자 UI에서 예약어(`admin`, `login` 등) 사용 시 경고/차단 로직을 추가해 리다이렉트 충돌을 예방합니다.
- **읽기 전용 CDN 캐시**: 공개 페이지 응답을 `Cache-Control`과 `ETag`로 캐싱하고, 페이지 저장 시 해당 슬러그 경로만 퍼지하도록 해 성능과 일관성을 확보합니다.
- **API 베이스 주입 개선**: 빌드 시 환경변수로 `API_BASE`를 삽입하고, 메타 태그 대신 `config.js`를 생성해 Pages/Workers 환경을 분리·문서화하면 잘못된 베이스로의 호출을 방지할 수 있습니다.
