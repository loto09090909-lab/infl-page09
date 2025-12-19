# 개발 현황 점검 및 개선 포인트

## 1. 현재 구현 상태 요약
- **API 진입점**: Cloudflare Worker가 `/api/pages/:pageId` 공개 조회, `/api/admin/*` 슈퍼 관리자 CRUD, `/api/page/:pageId/*` 페이지 관리자 로그인·저장을 라우팅합니다. CORS는 `ALLOWED_ORIGINS` 기반으로 동적으로 산출합니다.【F:worker/index.ts†L13-L87】
- **인증/세션**: 슈퍼·페이지·사용자 세션은 `TOKEN_SECRET` HMAC으로 서명된 토큰을 발급·검증하며, 로그아웃 시 jti를 KV에 폐기합니다. 신규 비밀번호는 PBKDF2(SHA-256)로 저장하고 기존 SHA-256 해시도 호환 검증합니다.【F:worker/auth.ts†L4-L93】【F:worker/auth.ts†L95-L152】【F:worker/users.ts†L19-L117】
- **페이지 관리 플로우**: 슈퍼 관리자는 D1 `super_admin`의 평문 비밀번호를 조회해 세션을 발급하고, 페이지 생성/수정 시 KV(`page:*`, `page_auth:*`)와 D1(`page_auth`, `page_meta`, `slug_map`)을 동시에 갱신합니다.【F:worker/super-admin.ts†L27-L240】 페이지 관리자는 저장 시 자신의 토큰 또는 슈퍼 토큰만 확인하고 동일하게 KV/D1을 덮어씁니다.【F:worker/page-admin.ts†L44-L94】
- **프런트엔드 흐름**: 여러 API 베이스를 하드코딩/추론(`known worker`, `pages.dev` 파생, 현재 origin)해 순차 호출하고, 슬러그 형태 URL에서는 `/api/pages/:slug`로 직접 데이터를 로드합니다. 관리자 저장은 `/api/page/{id}/save` 호출에 의존합니다.【F:public/js/script.js†L1-L285】
- **정적 라우팅**: `_redirects`가 `/user.html`, `/admin.html` 등으로 슬러그/관리자 경로를 리라이트하지만 최종 와일드카드가 여전히 `index.html`을 반환합니다.【F:public/_redirects†L1-L17】
- **컨택트 제출 흐름**: 공개 페이지에서 `contactSchema` 기반 폼을 렌더링하되 `contactSettings.enabled`가 true일 때만 노출·제출을 허용하고, IP 기준 제출 횟수를 제한하며 설정된 웹훅으로 알림을 전송합니다. 관리자 카드는 최신 내역을 조회하거나 CSV로 내보낼 수 있습니다.【F:public/js/script.js†L491-L578】【F:public/js/script.js†L1339-L1462】【F:worker/contact.ts†L12-L198】
- **컨택트 필드 커스터마이즈**: textarea/select/checkbox 타입과 필수/옵션 필드를 저장·검증하며, 선택지 없는 선택/체크박스는 차단하고 필수 항목 미입력 시 422로 응답합니다.【F:worker/page-admin.ts†L72-L120】【F:worker/contact.ts†L24-L164】【F:public/js/script.js†L828-L910】

## 2. 주요 위험 및 개선 필요 영역
- **레거시 해시 대응 필요**: 신규 저장은 PBKDF2로 강화했지만, 기존 SHA-256 해시를 계속 허용하므로 점진적인 재발급·교체 정책이 필요합니다.【F:worker/users.ts†L19-L117】【F:worker/super-admin.ts†L301-L376】
- **요청 검증 부재**: `parseJsonBody` 결과를 그대로 신뢰해 `profile/links/plan`을 KV·D1에 저장하므로 대형/비정형 입력이나 XSS 필드가 필터 없이 반영됩니다.【F:worker/super-admin.ts†L56-L240】【F:worker/page-admin.ts†L44-L94】
- **프런트-백 계약 불일치**: 프런트는 하드코딩된 워커 도메인을 순회하고 `/api/page/{id}/save` 엔드포인트만 사용해 저장하지만, 슬러그 기반 SSR이나 환경 분리가 전혀 없어 배포 환경이 바뀌면 API 탐색 실패 가능성이 높습니다.【F:public/js/script.js†L1-L285】
- **라우팅 충돌 위험**: `_redirects`의 최하단 `/* /index.html 200` 규칙이 슬러그 페이지보다 우선될 경우 `user.html`이 아닌 인덱스로 내려갈 수 있어 빈 화면이 노출될 수 있습니다.【F:public/_redirects†L1-L17】

## 3. 단기 개선 제안
- **인증 보강**: 슈퍼/페이지 관리자 비밀번호를 해시(Argon2/Bcrypt)로 저장하고, 서명된 세션(JWT 등)에 `role`·`sub`를 명시해 토큰 탈취 재사용을 차단하십시오.【F:worker/auth.ts†L3-L38】【F:worker/super-admin.ts†L27-L54】【F:worker/page-admin.ts†L15-L42】
- **입력 스키마 적용**: `pageId`, `profile`, `links`, `plan` 등에 대한 스키마 검증(Zod/Valibot)과 크기 제한을 추가해 KV/D1 오염을 방지하고, 필드별 오류를 400 응답으로 표준화하세요.【F:worker/super-admin.ts†L56-L240】【F:worker/page-admin.ts†L44-L94】
- **환경 설정 분리**: 프런트의 `API_BASES`를 빌드타임 환경 변수로 주입하거나 `config.js`를 생성해 하드코딩된 워커 URL 의존성을 제거하고, 저장 엔드포인트를 실제 백엔드 경로와 동기화하십시오.【F:public/js/script.js†L1-L285】
- **정적 리다이렉트 정리**: `_redirects`의 최종 와일드카드를 제거하거나 `user.html` 우선 규칙으로 재정렬해 슬러그 페이지가 항상 사용자 뷰로 연결되도록 확인하세요.【F:public/_redirects†L1-L17】

## 4. 신규 요구 반영 로드맵 (가입/프라이빗/알림)
- **가입·페이지 자동 생성**: 이메일/소셜 가입 시 기본 페이지와 페이지 관리자 계정을 동시에 만들고, 슈퍼 관리자가 생성한 페이지와 충돌하지 않도록 역할/권한 승격 규칙을 정립합니다.
- **플랜·권한 확장**: free/basic/premium 플랜별 페이지·링크·컨택트·프라이빗 링크 한도와 만료 정책을 정의하고, 업/다운그레이드 시 초과 자원의 처리(숨김/차단/알림)를 명확히 합니다.
- **프라이빗 페이지 수명 주기**: 난수 세그먼트·입장 코드·N회/N분 만료·비활성화/재발행 상태를 관리하고, 퍼블릭 페이지에서도 비밀 링크를 선택 적용할 수 있는 옵션을 추가합니다.
- **컨택트 전달 채널**: 웹훅 외 이메일·카카오톡 등 메시징 채널로 제출 내용을 전달하고, 실패 로그·재시도·수신자 관리(페이지 관리자/슈퍼 관리자 선택)를 지원합니다.
- **컨택트 폼 커스터마이즈**: 노출 토글 기본 비활성화, 필수/옵션/선택지 외 안내문·동의 체크·프리셋(명함/이벤트) 제공과 제출 이력/알림 연계를 설계합니다.

## 5. 측정·테스트/운영 계획
- **E2E 및 부하 테스트**: 가입→페이지 자동 생성→프라이빗 링크 발행/만료→컨택트 제출/알림까지 통합 시나리오를 자동화해 회귀를 방지합니다.
- **관측 및 모니터링**: 프라이빗 링크 만료, 컨택트 알림 실패, 플랜 한도 초과 시 이벤트 로깅·알림을 추가하고, 관리자 대시보드에서 상태·이력을 가시화합니다.

## 6. 슬러그/라우팅 추가 제안
- **서버사이드 렌더링/HTML 프리패치**: `Pages Functions`나 Worker에서 슬러그 요청 시 `user.html`을 불러와 KV/D1 데이터를 주입한 뒤 반환하면, 클라이언트 JS 실패 시에도 완성된 HTML이 노출됩니다.
- **라우트·도메인 검증 자동화**: 헬스체크 스크립트로 모든 슬러그(또는 샘플) 경로에 대해 200/콘텐츠 서명 여부를 배포 직후 검증하고 실패 시 알림하도록 CI를 구성합니다.
- **슬러그 예약어·중복 관리**: `slug_map`에 고유 제약을 적용하고, 관리자 UI에서 예약어(`admin`, `login` 등) 사용 시 경고/차단 로직을 추가해 리다이렉트 충돌을 예방합니다.
- **읽기 전용 CDN 캐시**: 공개 페이지 응답을 `Cache-Control`과 `ETag`로 캐싱하고, 페이지 저장 시 해당 슬러그 경로만 퍼지하도록 해 성능과 일관성을 확보합니다.
- **API 베이스 주입 개선**: 빌드 시 환경변수로 `API_BASE`를 삽입하고, 메타 태그 대신 `config.js`를 생성해 Pages/Workers 환경을 분리·문서화하면 잘못된 베이스로의 호출을 방지할 수 있습니다.
