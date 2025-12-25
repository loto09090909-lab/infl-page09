const DEFAULT_APP_CONFIG = {
  // Cloudflare Pages 환경 변수(API_BASE)에서 주입될 값
  apiBase: "__API_BASE_PLACEHOLDER__",
  
  // 배포 환경 라벨 (예: production, preview, local)
  envLabel: "__ENV_LABEL_PLACEHOLDER__",

  // 헬스체크 및 기타 기본 설정
  healthPath: "/api/health",
  allowQueryApiBase: true, // 테스트 시 api_base=? 쿼리로 변경 가능하도록 유지

  // 아래 탐색 기능들은 환경 변수가 주입된 경우 우선순위에서 밀리거나 꺼지게 됩니다.
  usePagesDerivedBase: false,
  useMetaApiBase: true,
  useGlobalApiBase: true,
  useKnownWorkerBase: false, // 하드코딩된 주소 사용 안 함
  useCurrentOriginBase: true,
  
  // 필요 시 수동 지정용 (일반적으로 빈 값 유지)
  apiBases: [],
};

window.APP_CONFIG = {
  ...DEFAULT_APP_CONFIG,
  ...(window.__APP_CONFIG__ || {}),
  ...(window.APP_CONFIG || {}),
};
