# Infl-Page 개발 체크리스트

## 1. 완료된 기능 (Implemented Features)

- [x] **코어 아키텍처 및 라우팅 (Core Architecture & Routing)**
  - [x] Cloudflare Worker 기반 API 라우터 구축 (`/api/*`)
  - [x] 동적 CORS 설정 (`ALLOWED_ORIGINS`)
  - [x] D1, KV 헬스체크 엔드포인트 (`/api/health`)
  - [x] 전역 에러 핸들링 및 요청 ID 로깅

- [x] **인증 및 권한 (Authentication & Authorization)**
  - [x] 슈퍼 관리자 부트스트랩 및 PBKDF2/SHA-256 하이브리드 로그인
  - [x] 사용자 가입 (이메일/비밀번호) 및 PBKDF2 로그인
  - [x] OAuth 2.0 소셜 로그인 프레임워크 (Google, GitHub 등)
  - [x] HMAC-SHA256 기반 서명 토큰 발급 및 검증 (JWT 스타일)
  - [x] KV를 이용한 토큰 폐기 (로그아웃)
  - [x] 페이지별 관리자 접근 제어 (초기 모델)
  - [x] 다중 사용자 권한 관리 시스템 (`page_members` - owner, editor, viewer)
  - [x] 이메일 기반 사용자 초대 기능 (`page_invites`)

- [x] **페이지 관리 (Page Management)**
  - [x] 슈퍼 관리자용 페이지 CRUD (생성, 조회, 수정, 삭제)
  - [x] 페이지 관리자용 페이지 저장 (`/api/page/:id/save`)
  - [x] 사용자별 페이지 목록 조회 및 CRUD (`/api/user/pages`)
  - [x] 페이지 데이터 KV-D1 이중 쓰기 (조회 최적화)
  - [x] 슬러그(고유 주소)와 페이지 ID 매핑 (`slug_map`)
  - [x] 회원가입 시 사용자에게 기본 페이지 자동 할당 (프로비저닝)

- [x] **컨택트 기능 (Contact Features)**
  - [x] 공개 페이지 컨택트 폼 제출 및 KV 저장
  - [x] IP 기반 제출 빈도 제한 (Rate Limiting)
  - [x] 관리자 대시보드에서 문의 내역 조회 및 CSV 다운로드
  - [x] Webhook을 통한 실시간 문의 알림
  - [x] 커스텀 필드 (text, textarea, select, checkbox) 및 유효성 검증
  - [x] 관리자가 컨택트 폼 노출 여부 제어

- [x] **플랜 및 제한 (Plans & Limits)**
  - [x] `plan_limits` 테이블을 통한 3단계 플랜(free, basic, premium) 정의
  - [x] 페이지 수, 프라이빗 링크 수, 컨택트 필드 수 등 기능 제한 적용 (부분)
  - [x] 플랜별 CSV 다운로드 및 통계 조회 권한 제어
  - [x] 현재 플랜 상태 조회 API

- [x] **프라이빗 링크 (Private Links)**
  - [x] 프라이빗 링크 생성, 조회, 삭제 기능
  - [x] 링크 상태 관리 (active, expired, usedup, revoked)
  - [x] 스케줄러를 이용한 만료 링크 자동 정리 (`prunePrivateLinks`)
  - [x] 템플릿 기반 프라이빗 링크 발급 기능

- [x] **기타 (Misc)**
  - [x] 감사 로그 기록 (`audit_logs` - 페이지 생성, 수정, 초대 등)
  - [x] 데이터베이스 마이그레이션 스크립트 (e.g., `users.plan_id` 추가)

---

## 2. 시급한 개선 및 구현 과제 (Urgent Improvements & Implementation Tasks)

- [x] **인증 및 보안 강화 (Security & Auth Hardening)**
  - [x] **비밀번호 해시 업그레이드**: 기존 SHA-256 해시 사용자를 로그인 시 최신 해시(PBKDF2)로 자동 전환하는 기능이 이미 구현되어 있음을 확인했습니다. (추가 개선: Argon2/Bcrypt)
  - [x] **입력 유효성 검증 (Input Validation)**: `validators.ts`를 중심으로 API 요청 본문에 대한 유효성 검증 로직을 표준화하고 적용했습니다.
  - [ ] **로그인 시도 제한 강화**: 슈퍼/페이지 관리자 로그인에 대한 브루트포스 공격 방어 로직 고도화 (계정 잠금 및 알림).
  - [ ] **토큰 관리 개선**: 토큰 서명 키 주기적 교체(Rotation) 및 다중 키 지원, 리프레시 토큰 도입으로 세션 보안 강화.

- [x] **API 및 프런트엔드 계약 수정 (API & Frontend Contract Fixes)**
  - [x] **API 환경 변수 분리**: 프런트엔드에 하드코딩된 API 주소를 제거하고, `config.js`를 통해 동적으로 API 주소를 결정하도록 수정했습니다.
  - [ ] **데드 코드 제거**: 프런트엔드에서 호출하는 존재하지 않는 API 엔드포인트(` /api/pages/save` 등)를 실제 경로에 맞게 수정 또는 제거.
  - [ ] **정적 라우팅 규칙 명확화**: Cloudflare Pages `_redirects` 파일에서 `/* /index.html 200` 규칙을 재검토하여 슬러그 페이지가 우선순위 문제로 빈 화면이 되는 현상 해결.

- [x] **플랜 및 권한 시스템 완성 (Plan & Permission System Completion)**
  - [x] **플랜별 제한 강제**: 자원 생성 시점에 플랜별 제한(페이지 수, 링크 수 등)이 강제되도록 구현되어 있음을 확인했습니다. (추가 개선: 등급 변경 시 정책)
  - [x] **관리자 권한 UI/UX**: 역할(owner, editor, viewer)에 따라 프런트엔드 UI의 특정 기능(수정, 삭제, 멤버 관리 등)을 비활성화하거나 숨기는 기능을 구현했습니다.
  - [ ] **초대 시스템 고도화**: 만료된 초대 재발급 및 초대 수락/거절 플로우 개선.

---

## 3. 향후 확장 제안 (Future Expansion Suggestions)

- [x] **사용자 경험 및 기능 고도화 (UX & Feature Enhancement)**
  - [x] **컨택트 폼 빌더**: 관리자 UI에서 문의 폼의 필드를 동적으로 추가/삭제하는 기본 기능을 구현했습니다. (추가 개선: 드래그앤드롭, 상세 옵션)
  - [ ] **컨택트 알림 채널 확장**: Webhook 외 이메일, 카카오톡 등 다양한 채널로 문의 알림 전송 및 실패/재시도 정책 구현.
  - [ ] **프라이빗 링크 UX 개선**: 만료/횟수 제한에 따른 상태를 사용자에게 명확히 안내하는 UI 추가 및 링크 재발행 기능.
  - [ ] **서버사이드 렌더링 (SSR)**: Pages Functions를 활용해 페이지 조회 시 서버에서 데이터를 미리 주입하여 초기 로딩 속도 개선 및 SEO 강화.

- [x] **운영 및 관측성 (Operations & Observability)**
  - [x] **통합 테스트 자동화**: 핵심 관리자 API 플로우(생성,조회,삭제)를 검증하는 E2E 테스트 스크립트를 작성하고 CI에 통합했습니다.
  - [ ] **모니터링 및 로깅 연동**: Sentry/Logpush 등 외부 서비스를 연동하여 에러 및 성능 문제를 실시간으로 추적하고 대시보드 구축.
  - [ ] **데이터 동기화 검증**: KV와 D1 간 데이터 불일치를 감지하고 자동으로 복구하는 스크립트 개발.
  - [ ] **API 문서화**: API 엔드포인트 명세(Request/Response)를 정리하고 문서로 자동화.

- [x] **성능 최적화 (Performance Optimization)**
  - [x] **CDN 캐시 전략 수립**: 공개 페이지 조회 API에 `ETag` 및 `Cache-Control` 헤더를 적용하여 캐시 효율을 높였습니다. (추가 개선: 캐시 퍼지 자동화)
  - [ ] **슬러그 관리**: 관리자 UI에서 예약어(`admin`, `login` 등) 사용을 막고, 중복 슬러그 생성을 방지하여 라우팅 충돌 예방.