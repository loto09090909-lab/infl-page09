# 누락된 요청 재정리 백로그

아래 템플릿으로 추가 요구사항을 정리합니다. (원본 링크/채널, 우선순위, 영향 범위를 함께 기록)

## 수집 소스
- 고객/운영 채널:
- 내부 논의:
- 기타:

## 누락 요청 목록
| ID | 요약 | 상세 | 우선순위 | 영향 범위 | 상태 |
| --- | --- | --- | --- | --- | --- |
| REQ-001 | 플랜 체계 정교화 | free/basic/premium 단계 정의 및 `plan_limits` 확장, 업/다운그레이드 정책 정리 | 높음 | worker/plan-limits.ts, DB 스키마 | 수집됨 |
| REQ-002 | 프라이빗 페이지 라이프사이클 | 난수 링크 생성/만료/재발행 UI·정책 확정 | 중간 | worker/private-links.ts, public/js/script.js | 수집됨 |
| REQ-003 | 관리자 권한 고도화(완성) | owner/editor/viewer 권한 매트릭스 UI/정책 확정 | 높음 | worker/page-members.ts, public/js/script.js | 수집됨 |
| REQ-004 | 컨택트 전달 채널 확장 | 웹훅 외 이메일/메시징 채널 및 실패 로그 | 중간 | worker/contact.ts | 수집됨 |
| REQ-005 | 컨택트 폼 고급 설정 | 안내문/동의/프리셋/플레이스홀더 확장 | 중간 | public/js/script.js, worker/validators.ts | 수집됨 |
| REQ-006 | 강화된 인증/세션 | 키 회전/리프레시 토큰/장치별 세션 관리 | 높음 | worker/auth.ts, worker/users.ts | 수집됨 |
| REQ-007 | 프런트엔드 환경 분리 마무리 | 빌드/배포 파이프라인에서 config 주입 | 중간 | public/config.js | 수집됨 |
| REQ-008 | 슈퍼 관리자 보안 UX | 잠금/해제, 2차 확인, 계정 보호 | 중간 | worker/super-admin.ts, public/js/suscript.js | 수집됨 |
| REQ-009 | 자동화된 통합 테스트 | 가입→페이지 생성→저장/컨택트 시나리오 | 중간 | scripts/ | 수집됨 |
| REQ-010 | 누락된 요청 재정리 | 채널별 요구사항 수집 및 우선순위 확정 | 낮음 | docs/REQUEST_BACKLOG.md | 수집됨 |

## 미확정 질문
- 
