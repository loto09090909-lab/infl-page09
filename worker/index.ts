import { json, html } from "./utils";  // 기존 유틸리티 함수들
import { superAdminLogin, createPage, listPages } from "./super-admin";  // 슈퍼 관리자 관련 함수들
import { pageAdminLogin, savePage } from "./page-admin";  // 페이지 관리자 관련 함수들

export default {
  async fetch(req: Request, env: any): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // --- 1. 정적 파일 라우팅 (Static File Routing) ---
    // 퍼블릭 HTML 파일을 Worker 코드 내에 정의하여 제공
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
    if (method === "POST" && path === "/api/admin/login") {
      return superAdminLogin(req, env);
    }

    if (method === "POST" && path === "/api/admin/pages") {
      return createPage(req, env);
    }

    if (method === "GET" && path === "/api/admin/pages") {
      return json(await listPages(env));
    }

    // 페이지 관리자 로그인 및 페이지 수정
    const pathSegments = path.split("/").filter(s => s.length > 0);
    
    if (pathSegments.length >= 3 && pathSegments[0] === "api") {
      const pageId = pathSegments[2]; // /api/page/PAGE_ID/
      const action = pathSegments[3]; // /api/page/PAGE_ID/ACTION

      if (method === "POST" && action === "login") {
         return pageAdminLogin(req, env, pageId);
      }

      if (method === "POST" && action === "save") {
         return savePage(req, env, pageId);
      }
    }

    // --- 3. 퍼블릭 페이지 라우팅 (Public Page Routing) ---
    if (method === "GET" && path.startsWith("/user/")) {
      const pageId = path.slice(6); // /user/{pageId}
      const data = await env.PAGE_KV.get(`page:${pageId}`);

      if (!data) return new Response("Not Found", { status: 404 });

      const page = JSON.parse(data);

      return html(`
        <!DOCTYPE html>
        <html lang="ko">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${page.profile.name}</title>
            <link rel="stylesheet" href="/style.css">
        </head>
        <body>
            <h1>${page.profile.name}</h1>
            <p>${page.profile.description}</p>
            <img src="${page.profile.photoUrl}" alt="${page.profile.name}" class="profile-photo">
            <ul id="links-list">
              ${page.links.map(link => `<li><a href="${link.url}" target="_blank">${link.name}</a></li>`).join('')}
            </ul>
            <script src="/script.js"></script>
        </body>
        </html>
      `);
    }

    // --- 4. 최종 404 응답 (Fallback) ---
    return new Response("Not Found", { status: 404 });
  }
};

// 정적 파일에 대한 응답 함수들
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

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}
