import { getBearerToken, verifySessionToken } from "./auth";
import { pageAdminLogin, savePage } from "./page-admin";
import {
  createPage,
  bulkCreatePages,
  deletePage,
  getAdminPage,
  listPages,
  invitePageAdmin,
  revokePageAdmin,
  superAdminLogin,
  updatePage,
} from "./super-admin";
import { getPage } from "./page-view";
import { buildCorsHeaders, CorsOptions, errorResponse } from "./utils";

export default {
  async fetch(req: Request, env: any): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    const corsOptions: CorsOptions = {
      allowedOrigins: (env.ALLOWED_ORIGINS ?? "*")
        .split(",")
        .map((origin: string) => origin.trim())
        .filter(Boolean),
    };
    const corsHeaders = buildCorsHeaders(corsOptions, req.headers.get("Origin"));
    const actingUserId = req.headers.get("x-user-id")?.trim() || null;

    // Preflight 처리
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (method === "GET" && path.startsWith("/api/pages/")) {
      const pageId = path.replace("/api/pages/", "");
      if (!pageId) {
        return errorResponse("pageId가 필요합니다", 400, corsHeaders);
      }
      return getPage(env, decodeURIComponent(pageId), corsHeaders);
    }

    // --- 1. 관리자 API ---
    if (method === "POST" && path === "/api/admin/login") {
      return superAdminLogin(req, env, corsHeaders);
    }

    const adminToken = getBearerToken(req);
    const isAdmin = await verifySessionToken(env, "super", adminToken);

    if (path === "/api/admin/pages/import" && method === "POST") {
      if (!isAdmin) return errorResponse("인증이 필요합니다", 401, corsHeaders);
      return bulkCreatePages(req, env, corsHeaders);
    }

    if (path === "/api/admin/pages" && method === "POST") {
      if (!isAdmin && !actingUserId)
        return errorResponse("인증이 필요합니다", 401, corsHeaders);
      return createPage(req, env, corsHeaders, {
        actingUserId,
        isSuperAdmin: isAdmin,
      });
    }

    if (path === "/api/admin/pages" && method === "GET") {
      if (!isAdmin) return errorResponse("인증이 필요합니다", 401, corsHeaders);
      return listPages(req, env, corsHeaders);
    }

    const adminPageMatch = path.match(/^\/api\/admin\/pages\/(.+)$/);
    if (adminPageMatch) {
      const pageId = adminPageMatch[1];
      if (!isAdmin && !actingUserId) {
        return errorResponse("인증이 필요합니다", 401, corsHeaders);
      }

      if (method === "GET") {
        return getAdminPage(env, decodeURIComponent(pageId), corsHeaders, {
          actingUserId,
          isSuperAdmin: isAdmin,
        });
      }

      if (method === "DELETE") {
        return deletePage(env, pageId, corsHeaders, {
          actingUserId,
          isSuperAdmin: isAdmin,
        });
      }

      if (method === "PUT") {
        return updatePage(req, env, pageId, corsHeaders, {
          actingUserId,
          isSuperAdmin: isAdmin,
        });
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

      if (method === "POST" && action === "save") {
        return savePage(req, env, pageId, corsHeaders);
      }

      if (action === "admins") {
        if (method === "POST") {
          return invitePageAdmin(req, env, pageId, corsHeaders, {
            actingUserId,
            isSuperAdmin: isAdmin,
          });
        }

        if (method === "DELETE" && pathSegments[4]) {
          return revokePageAdmin(env, pageId, pathSegments[4], corsHeaders, {
            actingUserId,
            isSuperAdmin: isAdmin,
          });
        }
      }
    }

    return errorResponse("Not Found", 404, corsHeaders);
  },
};
