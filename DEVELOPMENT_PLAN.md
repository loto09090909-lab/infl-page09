# Infl-Page 개발 로드맵 및 상세 계획

이 문서는 `CHECKLIST.md`에 명시된 개발 항목들을 실행 가능한 그룹으로 나누고, 각 그룹의 우선순위와 상세한 구현 지침을 정의합니다. 다른 AI 또는 개발자가 이 문서를 보고 작업을 이어서 수행할 수 있도록 구체적인 지시사항과 AI용 프롬프트를 포함합니다.

## 개발 우선순위 원칙
1.  **Phase 1: 보안 및 안정성 강화 (Security & Stability)** - 가장 시급한 보안 취약점과 시스템 안정성을 저해하는 버그를 해결합니다.
2.  **Phase 2: 핵심 기능 완성 (Core Feature Completion)** - 부분적으로 구현된 기능을 완성하고 사용자에게 안정적인 경험을 제공합니다.
3.  **Phase 3: 신규 기능 확장 (New Feature Expansion)** - 새로운 가치를 창출하는 기능을 추가합니다.
4.  **Phase 4: 운영 및 최적화 (Operations & Optimization)** - 장기적인 유지보수성과 성능을 개선합니다.

---

## Phase 1: 보안 및 안정성 강화 (Security & Stability)

**목표**: 시스템의 보안 취약점을 해결하고, 프런트엔드와 백엔드 간의 불일치를 수정하여 안정적인 기반을 마련합니다.

### 📝 Task 1-1: API 입력 유효성 검증 (Input Validation)

- **상태**: `완료 (Completed)`
- **목표**: 기존 `worker/validators.ts` 모듈을 확장하고, 여러 API 핸들러에 흩어져 있던 유효성 검증 로직을 중앙으로 통합하여 코드의 일관성과 유지보수성을 높입니다.
- **주요 파일**:
  - `worker/users.ts`
  - `worker/contact.ts`
  - `worker/validators.ts`
  - `worker/super-admin.ts`
  - `worker/page-admin.ts`

- **상세 지침**:
  1.  **완료**: `worker/validators.ts`에 `validateSignupBody`, `validateContactSubmission` 함수를 추가하여 회원가입 및 문의 제출에 대한 유효성 검증 로직을 중앙화했습니다.
  2.  **완료**: `worker/users.ts`의 `signup` 함수를 리팩터링하여, 기존의 수동 검증 로직을 `validateSignupBody` 함수 호출로 대체했습니다.
  3.  **완료**: `worker/contact.ts`의 `submitContact` 함수를 리팩터링하여, 복잡한 답변 검증 로직을 `validateContactSubmission` 함수 호출로 대체했습니다.
  4.  **확인**: `super-admin.ts`, `page-admin.ts`, `private-links.ts`는 이미 자체적으로 또는 `validators.ts`를 통해 유효성 검증을 수행하고 있음을 확인했습니다.

- **AI용 프롬프트**:
  > (작업 완료)

### 📝 Task 1-2: API 및 프런트엔드 환경 분리 (Environment Separation)

- **상태**: `완료 (Completed)`
- **목표**: 프런트엔드에 하드코딩된 API 주소를 제거하고, `config.js`를 통해 동적으로 API 주소를 결정하도록 수정하여 개발/운영 환경을 분리했습니다.
- **주요 파일**:
  - `public/js/script.js`
  - `public/config.js`
  - `public/*.html`

- **상세 지침**:
  1.  **완료**: `public/config.js` 파일을 생성하여, 현재 호스트네임(`window.location.hostname`)에 따라 로컬 및 운영 환경에 맞는 API 백엔드 주소를 반환하는 `getApiBaseUrl()` 함수를 정의했습니다.
  2.  **완료**: `public/js/script.js`에서 기존의 복잡한 API 주소 추론 로직 (`resolveApiBases`, `primeApiBaseSelection` 등)과 관련 전역 변수 및 디버깅 UI 함수들을 모두 제거하고, `getApiBaseUrl()` 함수를 사용하도록 `getApiBase` 함수를 단순화했습니다.
  3.  **완료**: 모든 `public/*.html` 파일에서 더 이상 필요 없는 `<meta name="api-base"...>` 태그와 API 디버그용 `<section id="api-debug"...>` 요소를 제거하여 코드를 정리했습니다.

- **AI용 프롬프트**:
  > (작업 완료)

### 📝 Task 1-3: 레거시 비밀번호 해시 자동 업그레이드 (Legacy Hash Upgrade)

- **상태**: `완료 (Completed)`
- **목표**: 기존 SHA-256 해시 사용자가 로그인 시, 자동으로 비밀번호를 최신 PBKDF2 해시로 업그레이드하여 데이터베이스에 저장하는 기능이 이미 구현되어 있음을 확인했습니다.
- **주요 파일**:
  - `worker/users.ts`
  - `worker/super-admin.ts`

- **상세 지침**:
  1.  **확인**: `worker/users.ts`의 `login` 함수와 `worker/super-admin.ts`의 `superAdminLogin` 함수 내에, `verifyPasswordWithUpgrade` 함수를 통해 레거시 해시 검증에 성공할 경우 `upgradedHash`를 받아 데이터베이스를 업데이트하는 로직이 이미 존재함을 확인했습니다.
  2.  **확인**: 해당 기능은 Cloudflare Worker의 `fetch` 핸들러 범위 내에서 동기적으로 실행되도록 구현되어 있습니다.

- **AI용 프롬프트**:
  > (작업 완료)

---

## Phase 2: 핵심 기능 완성 (Core Feature Completion)

**목표**: 부분적으로 구현된 플랜 및 권한 관리 기능을 완성하여, 완전한 서비스 정책을 적용하고 사용자에게 일관된 경험을 제공합니다.

### 📝 Task 2-1: 플랜별 기능 제한 강제 적용 (Plan Limit Enforcement)

- **상태**: `완료 (Completed)`
- **목표**: `worker/plan-limits.ts` 모듈 및 관련 함수들이 이미 구현되어 있고, 주요 API 핸들러에 정상적으로 적용되어 있음을 확인했습니다.
- **주요 파일**:
  - `worker/plan-limits.ts`
  - `worker/user-pages.ts`
  - `worker/super-admin.ts`

- **상세 지침**:
  1.  **확인**: `worker/plan-limits.ts` 파일에 `enforcePlanLimit`, `enforceMaxPages`, `enforcePrivateLinkLimit` 등 플랜 제한을 강제하는 주요 함수들이 이미 구현되어 있습니다.
  2.  **확인**: `worker/user-pages.ts`의 `createUserPage` 함수에서 페이지 생성 시 `enforceMaxPages`를 호출하여 최대 페이지 수를 검증합니다.
  3.  **확인**: `worker/user-pages.ts`의 `createUserPrivateLink` 함수에서 프라이빗 링크 생성 시 `enforcePrivateLinkLimit`를 호출하여 최대 링크 수를 검증합니다.
  4.  **확인**: `exportUserPageContactSubmissions`와 같은 다른 API들에서도 `enforcePlanLimit`를 통해 CSV 다운로드 등의 액션에 대한 권한을 검증하고 있습니다.
  5.  **결론**: 플랜별 기능 제한 로직의 핵심 부분은 이미 구현 및 적용 완료된 상태입니다.

- **AI용 프롬프트**:
  > (작업 완료)

### 📝 Task 2-2: 관리자 권한 프런트엔드 UI 적용 (Permission UI/UX)

- **상태**: `완료 (Completed)`
- **목표**: `page_members` 테이블의 역할(`owner`, `editor`, `viewer`)에 따라 프런트엔드 UI의 특정 기능(수정, 삭제, 멤버 관리 등)을 비활성화하거나 숨깁니다.
- **주요 파일**:
  - `worker/page-admin.ts`
  - `public/js/script.js`
  - `public/css/style.css`

- **상세 지침**:
  1.  **완료**: `worker/page-admin.ts`의 `verifyPageSession` 함수를 수정하여, 페이지 관리자의 세션 검증 시 `page_members` 테이블을 조회해 `owner`, `editor`, `viewer` 등의 구체적인 역할을 반환하도록 변경했습니다.
  2.  **완료**: `public/js/script.js`에 `currentUserRole` 전역 변수를 추가하고, `ensurePageSession` 함수에서 API 응답으로 받은 역할을 이 변수에 저장하도록 수정했습니다.
  3.  **완료**: 역할이 확정된 후, `applyRolePermissions` 함수를 호출하여 `<body>` 태그에 `role-owner`, `role-editor`와 같은 클래스를 동적으로 추가하는 로직을 구현했습니다.
  4.  **완료**: `public/css/style.css`에 `.role-viewer`, `.role-editor` 클래스에 따라 특정 UI 요소(저장 버튼, 고급 설정 탭 등)를 `display: none;` 처리하는 규칙을 추가하여 권한별 UI를 완성했습니다.

- **AI용 프롬프트**:
  > (작업 완료)

---

## Phase 3: 신규 기능 확장 (New Feature Expansion)

**목표**: 사용자에게 새로운 가치를 제공하고 서비스 매력도를 높이는 신규 기능을 개발합니다.

### 📝 Task 3-1: 컨택트 폼 빌더 및 알림 채널 확장 (Advanced Contact Form)

- **상태**: `완료 (Completed)`
- **목표**: 관리자가 UI를 통해 컨택트 폼 필드를 직접 추가/삭제할 수 있는 폼 빌더 기능을 구현했습니다.
- **주요 파일**:
  - `public/admin.html`
  - `public/js/script.js`
  - `worker/contact.ts`

- **상세 지침**:
  1.  **완료**: `public/admin.html`의 문의 폼 설정 카드에 필드 목록을 표시할 `<div>`와 새 필드를 추가할 `<form>`을 포함하여 UI 구조를 추가했습니다.
  2.  **완료**: `public/js/script.js`에 `renderContactSchemaEditor` 함수를 추가하여, `adminContactSchema` 배열의 데이터를 기반으로 폼 필드 목록을 동적으로 렌더링하는 로직을 구현했습니다. 각 필드에는 삭제 버튼이 포함됩니다.
  3.  **완료**: 새 필드 추가 폼의 제출 이벤트를 받아 `adminContactSchema` 배열에 데이터를 추가하고, 목록을 다시 렌더링하는 이벤트 리스너를 구현했습니다.
  4.  **확인**: 백엔드(`worker/contact.ts`)의 이메일 및 웹훅 알림 기능은 이미 구현되어 있음을 확인했습니다.

- **AI용 프롬프트**:
  > (작업 완료)

---

## Phase 4: 운영 및 최적화 (Operations & Optimization)

**목표**: 시스템의 장기적인 유지보수성, 성능, 안정성을 높이기 위한 기술 부채를 해결하고 운영 효율을 개선합니다.

### 📝 Task 4-1: E2E 통합 테스트 자동화 (E2E Test Automation)

- **상태**: `완료 (Completed)`
- **목표**: 핵심 Super Admin API 플로우를 검증하는 E2E(End-to-End) 테스트 스크립트를 작성하고 CI/CD 파이프라인에 통합했습니다.
- **주요 파일**:
  - `scripts/admin_e2e.sh` (신규)
  - `.github/workflows/main.yml`

- **상세 지침**:
  1.  **완료**: `scripts/admin_e2e.sh` 스크립트를 새로 작성했습니다. 이 스크립트는 `curl`과 Python을 사용하여 다음의 핵심 관리자 시나리오를 테스트합니다.
      - 임시 관리자 계정 생성 (`/api/admin/bootstrap`)
      - 로그인 및 토큰 획득 (`/api/admin/login`)
      - 토큰을 사용하여 새 페이지 생성 (`/api/admin/pages`)
      - 생성된 페이지의 공개 URL 접근성 확인
      - 생성했던 페이지 삭제 (`/api/admin/pages/:pageId`)
      - 삭제된 페이지에 접근 시 404가 반환되는지 확인
  2.  **완료**: `.github/workflows/main.yml` 워크플로우를 수정하여, 프로덕션 배포 전에 `wrangler dev`로 테스트 서버를 실행하고 `admin_e2e.sh` 스크립트를 실행하는 테스트 단계를 추가했습니다. 이를 통해 핵심 API의 회귀를 방지합니다.

- **AI용 프롬프트**:
  > (작업 완료)

### 📝 Task 4-2: CDN 캐시 전략 적용 (CDN Cache Strategy)

- **상태**: `완료 (Completed)`
- **목표**: 공개 페이지 조회 API 응답에 `Cache-Control` 및 `ETag` 헤더를 적용하여 CDN 캐시 효율을 높이고, 페이지 수정 시 캐시를 무효화해야 할 위치를 코드에 명시했습니다.
- **주요 파일**:
  - `worker/page-view.ts`
  - `worker/super-admin.ts`
  - `worker/user-pages.ts`

- **상세 지침**:
  1.  **완료**: `worker/page-view.ts`의 `getPage` 함수를 리팩터링하여, 페이지 데이터의 해시를 기반으로 `ETag`를 생성하도록 수정했습니다.
  2.  **완료**: 요청 헤더의 `If-None-Match`와 생성된 `ETag`가 일치하면, `304 Not Modified` 응답을 반환하여 불필요한 데이터 전송을 줄입니다.
  3.  **완료**: 공개적으로 조회되는 페이지에는 `Cache-Control: public, max-age=3600` 헤더를, 관리자 세션으로 조회하는 경우에는 `no-cache`를 적용하여 민감한 정보가 캐시되지 않도록 처리했습니다.
  4.  **완료**: 페이지 콘텐츠가 변경되는 `worker/super-admin.ts`의 `updatePage` 함수와 `worker/user-pages.ts`의 `updateUserPage` 함수에, 향후 Cloudflare API를 이용한 캐시 퍼지(Purge) 로직을 추가해야 할 위치를 주석으로 명시했습니다. (주석 내용: "TODO: 페이지 업데이트 시 Cloudflare API를 호출하여 관련 캐시를 퍼지(purge)해야 합니다. (예: `ctx.waitUntil(purgeCache(env, canonicalPageId))`)")

- **AI용 프롬프트**:
  > (작업 완료)

---
*이 문서는 작업 진행 상황에 따라 계속 업데이트됩니다.*