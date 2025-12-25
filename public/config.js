// infl-page09/public/config.js

/**
 * API 백엔드의 기본 URL을 결정합니다.
 * 현재 페이지의 호스트네임을 기반으로 운영 환경과 로컬 개발 환경을 구분합니다.
 *
 * @returns {string} API 요청에 사용될 기본 URL
 */
function getApiBaseUrl() {
  // 로컬 개발 환경 (Vite, http-server 등)
  if (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  ) {
    // 로컬에서 실행 중인 Cloudflare Worker 주소
    return "http://127.0.0.1:8787";
  }

  // 운영 환경 (Cloudflare Pages에 배포된 경우)
  // 관례적으로 운영 워커는 동일한 도메인의 '/api' 경로 또는
  // 별도의 서브도메인(예: api.yourdomain.com)을 사용할 수 있습니다.
  // 이 프로젝트에서는 별도의 ور커 도메인을 사용하므로, 해당 주소를 명시합니다.
  // 실제 프로젝트의 워커 주소로 변경해야 합니다.
  return "https://infl-worker.your-username.workers.dev"; // 🚨 실제 워커 주소로 변경 필요
}

window.APP_CONFIG = window.APP_CONFIG || {};
window.APP_CONFIG.apiBase = getApiBaseUrl(); 
window.API_BASE = window.APP_CONFIG.apiBase;