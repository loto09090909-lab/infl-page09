import { json, html } from "./utils";  // 기존 유틸리티 함수

export default {
  async fetch(req: Request, env: any): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // --- 1. 정적 파일 라우팅 (Static File Routing) ---

    // 퍼블릭 HTML 파일을 직접 Worker 코드 내에 정의하여 제공
    if (path === "/index.html") {
      const indexHtml = `
        <!DOCTYPE html>
        <html lang="ko">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Welcome to the index page</title>
            <link rel="stylesheet" href="/style.css">
        </head>
        <body>
            <div class="header">
                <h1>Welcome to the index page</h1>
                <p>Here is some example content for testing purposes.</p>
            </div>
            <script src="/script.js"></script>
        </body>
        </html>
      `;
      return new Response(indexHtml, { headers: { "Content-Type": "text/html; charset=UTF-8" } });
    }

    if (path === "/admin.html") {
      const adminHtml = `
        <!DOCTYPE html>
        <html lang="ko">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Admin Page</title>
            <link rel="stylesheet" href="/style.css">
        </head>
        <body>
            <h1>Admin Page</h1>
            <div class="admin-section">
                <h2>Page Management</h2>
                <input type="text" placeholder="Page Name">
                <button>Save</button>
            </div>
            <script src="/script.js"></script>
        </body>
        </html>
      `;
      return new Response(adminHtml, { headers: { "Content-Type": "text/html; charset=UTF-8" } });
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
      const pageId = pathSegments[2];
      const action = pathSegments[3];

      if (method === "POST" && action === "login") {
         return pageAdminLogin(req, env, pageId);
      }

      if (method === "POST" && action === "save") {
         return savePage(req, env, pageId);
      }
    }

    // --- 3. 퍼블릭 페이지 라우팅 (Public Page Routing) ---
    if (method === "GET" && path !== "/") {
      const pageId = path.slice(1);
      const data = await env.PAGE_KV.get(`page:${pageId}`);

      if (!data) return new Response("Not Found", { status: 404 });

      const page = JSON.parse(data);

      // 여기서 조회수 증가나 기타 처리를 추가할 수 있습니다.
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
    }

    // --- 4. 최종 404 응답 (Fallback) ---
    return new Response("Not Found", { status: 404 });
  }
};

// CSS와 JS는 여전히 직접 정의하거나 KV에서 가져올 수 있습니다.
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
