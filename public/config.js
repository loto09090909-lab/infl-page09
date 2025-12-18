// 전역 앱 설정을 정의합니다. 배포 환경에 맞게 apiBases와 envLabel을 수정하세요.
window.APP_CONFIG = window.APP_CONFIG || {
  // 우선순위가 높은 API 베이스 URL 목록 (프로토콜 포함)
  apiBases: [],
  // 배포/스테이지 구분을 나타내는 짧은 라벨
  envLabel: "local",
  // 헬스체크 경로 (기본값: /api/health)
  healthPath: "/api/health",
};
