// 유틸리티 함수는 기존 파일(./utils)에 있다고 가정합니다.
import { json, html } from "./utils"; 

// 기존에 import된 비즈니스 로직 함수들입니다.
import { superAdminLogin, createPage, listPages } from "./super-admin";
import { pageAdminLogin, savePage } from "./page-admin";
// import { incView, getStats } from "./stats"; // 사용되지 않는 함수는 일단 주석 처리
// import { locked, fail, clear } from "./login-guard"; // 사용되지 않는 함수는 일단 주석 처리

// 정적 파일 응답을 위한 내부 함수
function htmlResponse(content: string) {
  return new Response(content, {
    headers: { "Content-Type": "text/html; charset=UTF-8" },
  });
}

function cssResponse() {
  return new Response(`
    body { background-color: lightblue; }
    h1 { color: navy; }
  `, {
    headers: { "Content-Type": "text/css; charset=UTF-8" },
  });
}

function jsResponse() {
  return new Response(`
    console.log('JavaScript is working!');
  `, {
    headers: { "Content-Type": "application/javascript; charset=UTF-8" },
  });
}

export default {
  // Cloudflare Worker의 핵심 핸들러
  async fetch(req: Request, env: any): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // --- 1. 정적 파일 라우팅 (Static File Routing) ---

    // 특정 HTML 파일 서빙
    if (path === "/index.html") {
      return htmlResponse("<h1>Welcome to the index page</h1>");
    }
    if (path === "/admin.html") {
      return htmlResponse("<h1>Admin page</h1>");
    }

    // CSS 파일 서빙
    if (path.endsWith(".css")) {
      return cssResponse();
    }

    // JavaScript 파일 서빙
    if (path.endsWith(".js")) {
      return jsResponse();
    }

    // --- 2. API 라우팅 (API Routing) ---
    
    // Cloudflare Workers에서는 일반적으로 API 엔드포인트 앞에 /api 접두사를 붙여 정적 파일과 구분합니다.

    // 슈퍼 관리자 로그인: POST /api/admin/login
    if (method === "POST" && path === "/api/admin/login") {
      return superAdminLogin(req, env);
    }

    // 페이지 생성: POST /api/admin/pages
    if (method === "POST" && path === "/api/admin/pages") {
      return createPage(req, env);
    }

    // 페이지 목록 조회: GET /api/admin/pages
    if (method === "GET" && path === "/api/admin/pages") {
      // json 함수가 Promise를 자동으로 처리한다고 가정하고 await을 제거
      return json(await listPages(env)); 
    }

    // 페이지 관리자 로그인 및 페이지 수정 라우팅
    const pathSegments = path.split("/").filter(s => s.length > 0);
    
    // 예: /api/page/{pageId}/login, /api/page/{pageId}/save 패턴 처리
    // URL 패턴을 명확히 하기 위해 경로 구조를 조정했습니다.
    if (pathSegments.length >= 3 && pathSegments[0] === "api") {
      const pageId = pathSegments[2]; // /api/page/PAGE_ID/
      const action = pathSegments[3]; // /api/page/PAGE_ID/ACTION
      
      // 페이지 관리자 로그인: POST /api/page/{pageId}/login
      if (method === "POST" && action === "login") {
         return pageAdminLogin(req, env, pageId);
      }
      
      // 페이지 수정: POST /api/page/{pageId}/save
      if (method === "POST" && action === "save") {
         return savePage(req, env, pageId);
      }
    }
    
    // --- 3. 퍼블릭 페이지 라우팅 (Public Page Routing) ---
    
    // 루트 경로 (/)는 일반적으로 인덱스 페이지 또는 기타 응답을 반환합니다. 
    // 정적 파일 라우팅에서 "/index.html"을 처리했으므로, 여기서는 기본 404를 처리하기 전에 
    // 특정 페이지 ID 경로인지 확인합니다.
    
    if (method === "GET" && path !== "/") {
      // 페이지 ID는 / 다음에 오는 경로 자체입니다 (예: /my-awesome-page)
      const pageId = path.slice(1);
      
      if (pageId.startsWith('api/')) {
        // API 경로였는데 위에서 처리되지 않은 경우 (404)
        return new Response("API Not Found", { status: 404 });
      }

      const data = await env.PAGE_KV.get(`page:${pageId}`);

      if (!data) return new Response("Not Found", { status: 404 });

      try {
        const page = JSON.parse(data);
        
        // 뷰 카운트 증가 로직 (원래 코드에는 있었으나 import는 빠져있었습니다. 가정하여 추가.)
        // await incView(env, pageId); 
        
        return html(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>${page.profile.name}</title>
              <link rel="stylesheet" href="/style.css"> 
            </head>
            <body>
              <h1>${page.profile.name}</h1>
              <p>${page.profile.description}</p>
              <script src="/script.js"></script>
            </body>
          </html>
        `);
      } catch (e) {
        console.error("Error parsing KV data:", e);
        return new Response("Internal Server Error", { status: 500 });
      }
    }

    // --- 4. 최종 404 응답 (Fallback) ---
    
    // 위의 모든 라우팅 규칙에 해당하지 않는 경우
    return new Response("Not Found", { status: 404 });
  }
};
