# 개발 현황 점검 및 개선 포인트

## 1. 현재 구현 상태 요약
- **API 진입점**: Cloudflare Worker가 `/api/pages/:pageId` 공개 조회, `/api/admin/*` 슈퍼 관리자 CRUD, `/api/page/:pageId/*` 페이지 관리자 로그인·저장을 라우팅합니다. CORS는 `ALLOWED_ORIGINS` 기반으로 동적으로 산출합니다.【F:worker/index.ts†L13-L87】
- **인증/세션**: 슈퍼·페이지 관리자 모두 KV에 UUID 기반 세션 토큰을 기록하고 검증하며, 별도 서명이나 스코프 제한 없이 TTL만 적용됩니다.【F:worker/auth.ts†L3-L38】
- **페이지 관리 플로우**: 슈퍼 관리자는 D1 `super_admin`의 평문 비밀번호를 조회해 세션을 발급하고, 페이지 생성/수정 시 KV(`page:*`, `page_auth:*`)와 D1(`page_auth`, `page_meta`, `slug_map`)을 동시에 갱신합니다.【F:worker/super-admin.ts†L27-L240】 페이지 관리자는 저장 시 자신의 토큰 또는 슈퍼 토큰만 확인하고 동일하게 KV/D1을 덮어씁니다.【F:worker/page-admin.ts†L44-L94】
- **프런트엔드 흐름**: 여러 API 베이스를 하드코딩/추론(`known worker`, `pages.dev` 파생, 현재 origin)해 순차 호출하고, 슬러그 형태 URL에서는 `/api/pages/:slug`로 직접 데이터를 로드합니다. 관리자 저장은 `/api/page/{id}/save` 호출에 의존합니다.【F:public/js/script.js†L1-L285】
- **정적 라우팅**: `_redirects`가 `/user.html`, `/admin.html` 등으로 슬러그/관리자 경로를 리라이트하지만 최종 와일드카드가 여전히 `index.html`을 반환합니다.【F:public/_redirects†L1-L17】

## 2. 주요 위험 및 개선 필요 영역
- **평문 자격 증명과 약한 세션**: 비밀번호와 세션이 모두 평문/랜덤 UUID 수준이라 탈취 시 재사용을 막을 수 없고, 기기/역할별 스코프 구분이 없습니다.【F:worker/auth.ts†L3-L38】【F:worker/super-admin.ts†L27-L54】【F:worker/page-admin.ts†L15-L42】
- **요청 검증 부재**: `parseJsonBody` 결과를 그대로 신뢰해 `profile/links/plan`을 KV·D1에 저장하므로 대형/비정형 입력이나 XSS 필드가 필터 없이 반영됩니다.【F:worker/super-admin.ts†L56-L240】【F:worker/page-admin.ts†L44-L94】
- **프런트-백 계약 불일치**: 프런트는 하드코딩된 워커 도메인을 순회하고 `/api/page/{id}/save` 엔드포인트만 사용해 저장하지만, 슬러그 기반 SSR이나 환경 분리가 전혀 없어 배포 환경이 바뀌면 API 탐색 실패 가능성이 높습니다.【F:public/js/script.js†L1-L285】
- **라우팅 충돌 위험**: `_redirects`의 최하단 `/* /index.html 200` 규칙이 슬러그 페이지보다 우선될 경우 `user.html`이 아닌 인덱스로 내려갈 수 있어 빈 화면이 노출될 수 있습니다.【F:public/_redirects†L1-L17】

## 3. 단기 개선 제안
- **인증 보강**: 슈퍼/페이지 관리자 비밀번호를 해시(Argon2/Bcrypt)로 저장하고, 서명된 세션(JWT 등)에 `role`·`sub`를 명시해 토큰 탈취 재사용을 차단하십시오.【F:worker/auth.ts†L3-L38】【F:worker/super-admin.ts†L27-L54】【F:worker/page-admin.ts†L15-L42】
- **입력 스키마 적용**: `pageId`, `profile`, `links`, `plan` 등에 대한 스키마 검증(Zod/Valibot)과 크기 제한을 추가해 KV/D1 오염을 방지하고, 필드별 오류를 400 응답으로 표준화하세요.【F:worker/super-admin.ts†L56-L240】【F:worker/page-admin.ts†L44-L94】
- **환경 설정 분리**: 프런트의 `API_BASES`를 빌드타임 환경 변수로 주입하거나 `config.js`를 생성해 하드코딩된 워커 URL 의존성을 제거하고, 저장 엔드포인트를 실제 백엔드 경로와 동기화하십시오.【F:public/js/script.js†L1-L285】
- **정적 리다이렉트 정리**: `_redirects`의 최종 와일드카드를 제거하거나 `user.html` 우선 규칙으로 재정렬해 슬러그 페이지가 항상 사용자 뷰로 연결되도록 확인하세요.【F:public/_redirects†L1-L17】
