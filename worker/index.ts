import { getBearerToken, verifySessionToken } from "./auth";
import { pageAdminLogin, pageAdminLogout, savePage, verifyPageSession } from "./page-admin";
import {
  createPage,
  bulkCreatePages,
  deletePage,
  getAdminPage,
  listPages,
  bootstrapSuperAdmin,
  superAdminLogin,
  superAdminLogout,
  updatePage,
} from "./super-admin";
import { getPage } from "./page-view";
import { buildCorsHeaders, CorsOptions, errorResponse, jsonResponse } from "./utils";
import { login as userLogin, signup as userSignup } from "./users";
import {
  createUserPage,
  deleteUserPage,
  getUserPage,
  listUserPages,
  updateUserPage,
} from "./user-pages";

export default {
  async fetch(req: Request, env: any): Promise<Response> {
    // 1. 전역 에러 핸들러 추가
    try {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      // 2. CORS 안전하게 처리
      const rawOrigins = env.ALLOWED_ORIGINS || "*";
      const corsOptions: CorsOptions = {
        allowedOrigins: rawOrigins.split(",").map((o: string) => o.trim()).filter(Boolean),
      };
      const corsHeaders = buildCorsHeaders(corsOptions, req.headers.get("Origin"));

      if (method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

    if (method === "GET" && path.startsWith("/api/pages/")) {
      const pageId = path.replace("/api/pages/", "");
      if (!pageId) {
        return errorResponse("pageId가 필요합니다", 400, corsHeaders);
      }
      return getPage(req, env, decodeURIComponent(pageId), corsHeaders);
    }

    if (method === "POST" && path.startsWith("/api/pages/") && path.endsWith("/contact")) {
      const pageId = decodeURIComponent(path.replace(/\/api\/pages\//, "").replace(/\/contact$/, ""));
      if (!pageId) {
        return errorResponse("pageId가 필요합니다", 400, corsHeaders);
      }
      const { submitContact } = await import("./contact");
      return submitContact(req, env, pageId, corsHeaders);
    }

    if (method === "GET" && path === "/api/health") {
      return jsonResponse(
        { ok: true, time: new Date().toISOString() },
        200,
        corsHeaders
      );
    }

    // --- 사용자 가입/로그인 ---
    if (method === "POST" && path === "/api/users/signup") {
      return userSignup(req, env, corsHeaders);
    }

    if (method === "POST" && path === "/api/users/login") {
      return userLogin(req, env, corsHeaders);
    }

    if (method === "POST" && path === "/api/user/pages") {
      return createUserPage(req, env, corsHeaders);
    }

    if (method === "GET" && path === "/api/user/pages") {
      return listUserPages(req, env, corsHeaders);
    }

    const userPageMatch = path.match(/^\/api\/user\/pages\/(.+)$/);
    if (userPageMatch) {
      const pageId = decodeURIComponent(userPageMatch[1]);

      if (method === "GET") {
        return getUserPage(req, env, corsHeaders, pageId);
      }

      if (method === "PUT") {
        return updateUserPage(req, env, corsHeaders, pageId);
      }

      if (method === "DELETE") {
        return deleteUserPage(req, env, corsHeaders, pageId);
      }
    }

    // --- 1. 관리자 API ---
    if (
      method === "POST" &&
      (path === "/api/super-admin/bootstrap" || path === "/api/admin/bootstrap")
    ) {
      return bootstrapSuperAdmin(req, env, corsHeaders);
    }

    if (
      method === "POST" &&
      (path === "/api/super-admin/login" || path === "/api/admin/login")
    ) {
      return superAdminLogin(req, env, corsHeaders);
    }

    if (
      method === "POST" &&
      (path === "/api/super-admin/logout" || path === "/api/admin/logout")
    ) {
      return superAdminLogout(req, env, corsHeaders);
    }

    const adminToken = getBearerToken(req);
    const isAdmin = await verifySessionToken(env, "super", adminToken);

    const isSuperAdminRoute =
      path.startsWith("/api/super-admin/") || path.startsWith("/api/admin/");

    if (isSuperAdminRoute && !isAdmin) {
      return errorResponse("슈퍼 관리자 인증이 필요합니다", 401, corsHeaders);
    }

    if (
      isSuperAdminRoute &&
      path.replace("/api/super-admin", "/api/admin") === "/api/admin/pages/import" &&
      method === "POST"
    ) {
      return bulkCreatePages(req, env, corsHeaders);
    }

    if (
      isSuperAdminRoute &&
      path.replace("/api/super-admin", "/api/admin") === "/api/admin/pages" &&
      method === "POST"
    ) {
      return createPage(req, env, corsHeaders);
    }

    if (
      isSuperAdminRoute &&
      path.replace("/api/super-admin", "/api/admin") === "/api/admin/pages" &&
      method === "GET"
    ) {
      return listPages(req, env, corsHeaders);
    }

    const adminPageMatch = path
      .replace("/api/super-admin", "/api/admin")
      .match(/^\/api\/admin\/pages\/(.+)$/);
    if (isSuperAdminRoute && adminPageMatch) {
      const pageId = adminPageMatch[1];

      if (method === "GET") {
        return getAdminPage(env, decodeURIComponent(pageId), corsHeaders);
      }

      if (method === "DELETE") {
        return deletePage(env, pageId, corsHeaders);
      }

      if (method === "PUT") {
        return updatePage(req, env, pageId, corsHeaders);
      }
    }

    // --- 2. 페이지 관리자 API ---
    const pathSegments = path.split("/").filter(Boolean);
    if (pathSegments.length >= 3 && pathSegments[0] === "api" && pathSegments[1] === "page") {
      const pageId = pathSegments[2];
      const action = pathSegments[3];

      if (method === "POST" && action === "login") {
        return pageAdminLogin(req, env, pageId, corsHeaders);
      }

      if (method === "POST" && action === "logout") {
        return pageAdminLogout(req, env, pageId, corsHeaders);
      }

      if (method === "GET" && action === "session") {
        return verifyPageSession(req, env, pageId, corsHeaders);
      }

      if (method === "POST" && action === "save") {
        return savePage(req, env, pageId, corsHeaders);
      }

      if (method === "GET" && action === "contact-submissions") {
        const { listContactSubmissions } = await import("./contact");
        return listContactSubmissions(req, env, pageId, corsHeaders);
      }

      if (method === "GET" && action === "contact-submissions.csv") {
        const { exportContactSubmissions } = await import("./contact");
        return exportContactSubmissions(req, env, pageId, corsHeaders);
      }
    }

    return errorResponse("Not Found", 404, corsHeaders);

    } catch (err: any) {
      // 에러 발생 시 상세 메시지 반환 (디버깅용)
      return new Response(JSON.stringify({ 
        error: "Worker Runtime Error", 
        message: err.message,
        stack: err.stack 
      }), {
        status: 500,
        headers: { 
          "Content-Type": "application/json", 
          "Access-Control-Allow-Origin": "*" 
        }
      });
    }
  },
};
