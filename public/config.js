// 전역 앱 설정을 정의합니다. 배포 환경에 맞게 apiBases와 envLabel을 수정하세요.
window.APP_CONFIG = window.APP_CONFIG || {
  // 우선순위가 높은 API 베이스 URL 목록 (프로토콜 포함)
  apiBases: [],
  // 단일 기본 API 베이스(배열보다 우선, 값이 있으면 첫 번째 후보가 됩니다)
  apiBase: undefined,
  // 배포/스테이지 구분을 나타내는 짧은 라벨
  envLabel: "local",
  // 헬스체크 경로 (기본값: /api/health)
  healthPath: "/api/health",
  // 특정 호스트를 항상 우선 사용하려면 preferredApiBase를 지정하세요
  preferredApiBase: "https://infl-worker.loto09090909.workers.dev",
  // 쿼리파라미터(api_base)로 베이스 오버라이드를 허용하지 않으려면 false로 설정
  allowQueryApiBase: true,
  // pages.dev -> workers.dev 유추, meta/api-base, 현재 origin, 알려진 워커를 끄고 싶다면 false로 설정
  usePagesDerivedBase: true,
  useMetaApiBase: true,
  useGlobalApiBase: true,
  useKnownWorkerBase: true,
  useCurrentOriginBase: true,
  // 기본 알려진 워커 베이스를 바꾸고 싶을 때 지정
  knownWorkerBase: "https://infl-worker.loto09090909.workers.dev",
  // Turnstile 사이트 키 (없으면 자동으로 비활성화)
  turnstileSiteKey: undefined,
};
