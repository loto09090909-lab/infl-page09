import { getBearerToken, hasSessionSecret, verifySessionToken } from "./auth";
import {
  pageAdminLogin,
  pageAdminLogout,
  disableAccessCode,
  rotateAccessCode,
  savePage,
  verifyPageSession,
} from "./page-admin";
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
import { errorResponse, jsonResponse } from "./utils";
import { login as userLogin, signup as userSignup, deleteUserById } from "./users";
import {
  createUserPage,
  deleteUserPage,
  getUserPage,
  getUserPageStats,
  createUserPrivateLink,
  deleteUserPrivateLink,
  exportUserPageContactSubmissions,
  listUserPages,
  listUserPageContactSubmissions,
  deleteUserPageContactSubmissions,
  listUserPrivateLinks,
  disableUserAccessCode,
  rotateUserAccessCode,
  updateUserPage,
  acceptUserInvite,
  createUserPageInvite,
  listUserPageInvites,
  listUserPageMembers,
  removeUserPageMember,
  revokeUserPageInvite,
  getUserPagePlanStatus,
} from "./user-pages";
import { createRandomPrivateLink, getPrivatePage, prunePrivateLinks } from "./private-links";
import { startOAuth, handleOAuthCallback } from "./oauth";

export default {
  async fetch(req: Request, env: any): Promise<Response> {
    const requestId = crypto.randomUUID();
    // 2. CORS 안전하게 처리
    const rawOrigins = env.ALLOWED_ORIGINS || "";
    const allowedOrigins = rawOrigins.split(",").map((o: string) => o.trim()).filter(Boolean);

    const originHeader = req.headers.get("Origin");
    const hasWildcard = allowedOrigins.includes("*");
    const isAllowedOrigin = originHeader ? allowedOrigins.includes(originHeader) : false;

    const corsOrigin = hasWildcard
      ? "*"
      : isAllowedOrigin
      ? originHeader
      : originHeader
      ? allowedOrigins[0] || "null"
      : allowedOrigins[0] || "*";
    const allowCredentials = !hasWildcard && isAllowedOrigin;

    const corsHeaders = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Credentials": allowCredentials ? "true" : "false",
      Vary: "Origin",
    };
    const responseHeaders = {
      ...corsHeaders,
      "X-Request-Id": requestId,
    };
    const logEvent = (level: "info" | "warn" | "error", message: string, extra?: any) => {
      const payload = {
        level,
        message,
        requestId,
        path: req.url,
        method: req.method,
        ...(extra ? { extra } : {}),
      };
      if (level === "error") {
        console.error(payload);
      } else if (level === "warn") {
        console.warn(payload);
      } else {
        console.log(payload);
      }
    };

    // 1. 전역 에러 핸들러 추가
    try {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      if (method === "OPTIONS") {
        return new Response(null, { status: 204, headers: responseHeaders });
      }

    if (path.startsWith("/api/super-admin/")) {
      const redirectUrl = new URL(req.url);
      redirectUrl.pathname = path.replace("/api/super-admin/", "/api/admin/");
      return new Response(null, {
        status: 308,
        headers: {
          ...responseHeaders,
          Location: redirectUrl.toString(),
        },
      });
    }

    if (
      method === "GET" &&
      path.startsWith("/api/pages/") &&
      !path.includes("/private/") &&
      !path.endsWith("/random")
    ) {
      const pageId = path.replace("/api/pages/", "");
      if (!pageId) {
        return errorResponse("pageId가 필요합니다", 400, responseHeaders);
      }
      return getPage(req, env, decodeURIComponent(pageId), responseHeaders);
    }

    if (method === "POST" && path.startsWith("/api/pages/") && path.endsWith("/contact")) {
      const pageId = decodeURIComponent(path.replace(/\/api\/pages\//, "").replace(/\/contact$/, ""));
      if (!pageId) {
        return errorResponse("pageId가 필요합니다", 400, responseHeaders);
      }
      const { submitContact } = await import("./contact");
      return submitContact(req, env, pageId, responseHeaders);
    }

    if (method === "GET" && path === "/api/health") {
      let kvOk = true;
      let dbOk = true;
      try {
        await env.PAGE_KV.get("health:probe");
      } catch (error) {
        kvOk = false;
        logEvent("warn", "KV health check failed", error);
      }
      try {
        await env.DB.prepare("SELECT 1").first();
      } catch (error) {
        dbOk = false;
        logEvent("warn", "DB health check failed", error);
      }
      return jsonResponse(
        {
          ok: kvOk && dbOk,
          time: new Date().toISOString(),
          authSecretConfigured: hasSessionSecret(env),
          kvOk,
          dbOk,
          requestId,
        },
        kvOk && dbOk ? 200 : 503,
        responseHeaders
      );
    }

    if (method === "GET" && path.startsWith("/api/auth/")) {
      const match = path.match(/^\/api\/auth\/([^/]+)\/start$/);
      if (match) {
        const provider = match[1];
        return startOAuth(req, env, responseHeaders, provider);
      }
    }

    if (method === "GET" && path.startsWith("/api/auth/")) {
      const match = path.match(/^\/api\/auth\/([^/]+)\/callback$/);
      if (match) {
        const provider = match[1];
        return handleOAuthCallback(req, env, responseHeaders, provider);
      }
    }

    // --- 사용자 가입/로그인 ---
    if (method === "POST" && path === "/api/users/signup") {
      return userSignup(req, env, responseHeaders);
    }

    if (method === "POST" && path === "/api/users/login") {
      return userLogin(req, env, responseHeaders);
    }

    const userDeleteMatch = path.match(/^\/api\/users\/(.+)$/);
    if (method === "DELETE" && userDeleteMatch) {
      const userId = decodeURIComponent(userDeleteMatch[1]);
      const token = getBearerToken(req);
      const isAdmin = await verifySessionToken(env, "super", token);
      if (!isAdmin) {
        return errorResponse("슈퍼 관리자 인증이 필요합니다", 401, responseHeaders);
      }
      return deleteUserById(env, responseHeaders, userId);
    }

    if (method === "GET" && path.startsWith("/api/pages/") && path.includes("/private/")) {
      const match = path.match(/^\/api\/pages\/(.+)\/private\/(.+)$/);
      if (!match) {
        return errorResponse("Not Found", 404, responseHeaders);
      }
      const pageId = decodeURIComponent(match[1]);
      const token = decodeURIComponent(match[2]);
      return getPrivatePage(req, env, responseHeaders, pageId, token);
    }

    if (method === "GET" && path.startsWith("/api/pages/") && path.endsWith("/random")) {
      const match = path.match(/^\/api\/pages\/(.+)\/random$/);
      if (!match) {
        return errorResponse("Not Found", 404, responseHeaders);
      }
      const pageId = decodeURIComponent(match[1]);
      return createRandomPrivateLink(req, env, responseHeaders, pageId);
    }

    if (method === "POST" && path === "/api/user/pages") {
      return createUserPage(req, env, responseHeaders);
    }

    if (method === "GET" && path === "/api/user/pages") {
      return listUserPages(req, env, responseHeaders);
    }

    const userPageMatch = path.match(/^\/api\/user\/pages\/(.+)$/);
    if (userPageMatch) {
      const pageId = decodeURIComponent(userPageMatch[1]);

      if (method === "GET") {
        return getUserPage(req, env, responseHeaders, pageId);
      }

      if (method === "PUT") {
        return updateUserPage(req, env, responseHeaders, pageId);
      }

      if (method === "DELETE") {
        return deleteUserPage(req, env, responseHeaders, pageId);
      }
    }

    const userPrivateMatch = path.match(/^\/api\/user\/pages\/(.+)\/private-links$/);
    if (userPrivateMatch) {
      const pageId = decodeURIComponent(userPrivateMatch[1]);
      if (method === "POST") {
        return createUserPrivateLink(req, env, responseHeaders, pageId);
      }
      if (method === "GET") {
        return listUserPrivateLinks(req, env, responseHeaders, pageId);
      }
    }

    const userPrivateTokenMatch = path.match(/^\/api\/user\/pages\/(.+)\/private-links\/(.+)$/);
    if (userPrivateTokenMatch) {
      const pageId = decodeURIComponent(userPrivateTokenMatch[1]);
      const token = decodeURIComponent(userPrivateTokenMatch[2]);
      if (method === "DELETE") {
        return deleteUserPrivateLink(req, env, responseHeaders, pageId, token);
      }
    }

    const userMembersMatch = path.match(/^\/api\/user\/pages\/(.+)\/members$/);
    if (userMembersMatch) {
      const pageId = decodeURIComponent(userMembersMatch[1]);
      if (method === "GET") {
        return listUserPageMembers(req, env, responseHeaders, pageId);
      }
    }

    const userMemberMatch = path.match(/^\/api\/user\/pages\/(.+)\/members\/(.+)$/);
    if (userMemberMatch) {
      const pageId = decodeURIComponent(userMemberMatch[1]);
      const memberUserId = decodeURIComponent(userMemberMatch[2]);
      if (method === "DELETE") {
        return removeUserPageMember(req, env, responseHeaders, pageId, memberUserId);
      }
    }

    const userInvitesMatch = path.match(/^\/api\/user\/pages\/(.+)\/invites$/);
    if (userInvitesMatch) {
      const pageId = decodeURIComponent(userInvitesMatch[1]);
      if (method === "POST") {
        return createUserPageInvite(req, env, responseHeaders, pageId);
      }
      if (method === "GET") {
        return listUserPageInvites(req, env, responseHeaders, pageId);
      }
    }

    const userInviteMatch = path.match(/^\/api\/user\/pages\/(.+)\/invites\/(.+)$/);
    if (userInviteMatch) {
      const pageId = decodeURIComponent(userInviteMatch[1]);
      const token = decodeURIComponent(userInviteMatch[2]);
      if (method === "DELETE") {
        return revokeUserPageInvite(req, env, responseHeaders, pageId, token);
      }
    }

    const userInviteAcceptMatch = path.match(/^\/api\/user\/invites\/(.+)\/accept$/);
    if (userInviteAcceptMatch && method === "POST") {
      const token = decodeURIComponent(userInviteAcceptMatch[1]);
      return acceptUserInvite(req, env, responseHeaders, token);
    }

    const userContactMatch = path.match(/^\/api\/user\/pages\/(.+)\/contact-submissions$/);
    if (userContactMatch) {
      const pageId = decodeURIComponent(userContactMatch[1]);
      if (method === "GET") {
        return listUserPageContactSubmissions(req, env, responseHeaders, pageId);
      }
      if (method === "DELETE") {
        return deleteUserPageContactSubmissions(req, env, responseHeaders, pageId);
      }
    }

    const userContactCsvMatch = path.match(/^\/api\/user\/pages\/(.+)\/contact-submissions\.csv$/);
    if (userContactCsvMatch && method === "GET") {
      const pageId = decodeURIComponent(userContactCsvMatch[1]);
      return exportUserPageContactSubmissions(req, env, responseHeaders, pageId);
    }

    const userStatsMatch = path.match(/^\/api\/user\/pages\/(.+)\/stats$/);
    if (userStatsMatch && method === "GET") {
      const pageId = decodeURIComponent(userStatsMatch[1]);
      return getUserPageStats(req, env, responseHeaders, pageId);
    }

    const userPlanStatusMatch = path.match(/^\/api\/user\/pages\/(.+)\/plan-status$/);
    if (userPlanStatusMatch && method === "GET") {
      const pageId = decodeURIComponent(userPlanStatusMatch[1]);
      return getUserPagePlanStatus(req, env, responseHeaders, pageId);
    }

    const userAccessCodeMatch = path.match(/^\/api\/user\/pages\/(.+)\/access-code\/rotate$/);
    if (userAccessCodeMatch && method === "POST") {
      const pageId = decodeURIComponent(userAccessCodeMatch[1]);
      return rotateUserAccessCode(req, env, responseHeaders, pageId);
    }

    const userAccessCodeDisableMatch = path.match(/^\/api\/user\/pages\/(.+)\/access-code\/disable$/);
    if (userAccessCodeDisableMatch && method === "POST") {
      const pageId = decodeURIComponent(userAccessCodeDisableMatch[1]);
      return disableUserAccessCode(req, env, responseHeaders, pageId);
    }

    // --- 1. 관리자 API ---
    if (
      method === "POST" &&
      (path === "/api/super-admin/bootstrap" || path === "/api/admin/bootstrap")
    ) {
      return bootstrapSuperAdmin(req, env, responseHeaders);
    }

    if (
      method === "POST" &&
      (path === "/api/super-admin/login" || path === "/api/admin/login")
    ) {
      return superAdminLogin(req, env, responseHeaders);
    }

    if (
      method === "POST" &&
      (path === "/api/super-admin/logout" || path === "/api/admin/logout")
    ) {
      return superAdminLogout(req, env, responseHeaders);
    }

    const adminToken = getBearerToken(req);
    const isAdmin = await verifySessionToken(env, "super", adminToken);

    const isSuperAdminRoute =
      path.startsWith("/api/super-admin/") || path.startsWith("/api/admin/");

    if (isSuperAdminRoute && !isAdmin) {
      return errorResponse("슈퍼 관리자 인증이 필요합니다", 401, responseHeaders);
    }

    if (
      isSuperAdminRoute &&
      path.replace("/api/super-admin", "/api/admin") === "/api/admin/pages/import" &&
      method === "POST"
    ) {
      return bulkCreatePages(req, env, responseHeaders);
    }

    if (
      isSuperAdminRoute &&
      path.replace("/api/super-admin", "/api/admin") === "/api/admin/pages" &&
      method === "POST"
    ) {
      return createPage(req, env, responseHeaders);
    }

    if (
      isSuperAdminRoute &&
      path.replace("/api/super-admin", "/api/admin") === "/api/admin/pages" &&
      method === "GET"
    ) {
      return listPages(req, env, responseHeaders);
    }

    const adminPageMatch = path
      .replace("/api/super-admin", "/api/admin")
      .match(/^\/api\/admin\/pages\/(.+)$/);
    if (isSuperAdminRoute && adminPageMatch) {
      const pageId = adminPageMatch[1];

      if (method === "GET") {
        return getAdminPage(env, decodeURIComponent(pageId), responseHeaders);
      }

      if (method === "DELETE") {
        return deletePage(env, pageId, responseHeaders);
      }

      if (method === "PUT") {
        return updatePage(req, env, pageId, responseHeaders);
      }
    }

    // --- 2. 페이지 관리자 API ---
    const pathSegments = path.split("/").filter(Boolean);
    if (pathSegments.length >= 3 && pathSegments[0] === "api" && pathSegments[1] === "page") {
      const pageId = pathSegments[2];
      const action = pathSegments[3];

      if (method === "POST" && action === "login") {
        return pageAdminLogin(req, env, pageId, responseHeaders);
      }

      if (method === "POST" && action === "logout") {
        return pageAdminLogout(req, env, pageId, responseHeaders);
      }

      if (method === "GET" && action === "session") {
        return verifyPageSession(req, env, pageId, responseHeaders);
      }

      if (method === "POST" && action === "save") {
        return savePage(req, env, pageId, responseHeaders);
      }

      if (method === "POST" && action === "access-code" && pathSegments[4] === "rotate") {
        return rotateAccessCode(req, env, pageId, responseHeaders);
      }

      if (method === "POST" && action === "access-code" && pathSegments[4] === "disable") {
        return disableAccessCode(req, env, pageId, responseHeaders);
      }

      if (method === "GET" && action === "contact-submissions") {
        const { listContactSubmissions } = await import("./contact");
        return listContactSubmissions(req, env, pageId, responseHeaders);
      }

      if (method === "DELETE" && action === "contact-submissions") {
        const { deleteContactSubmissions } = await import("./contact");
        return deleteContactSubmissions(req, env, pageId, responseHeaders);
      }

      if (method === "GET" && action === "contact-submissions.csv") {
        const { exportContactSubmissions } = await import("./contact");
        return exportContactSubmissions(req, env, pageId, responseHeaders);
      }

      if (method === "GET" && action === "plan-status") {
        const { getPagePlanStatus } = await import("./page-admin");
        return getPagePlanStatus(req, env, pageId, responseHeaders);
      }

      if (action === "private-templates") {
        const templateId = pathSegments[4];
        const actionNext = pathSegments[5];
        const {
          listPrivateTemplates,
          createPrivateTemplate,
          deletePrivateTemplate,
          issuePrivateLinkFromTemplate,
        } = await import("./private-templates");

        if (!templateId && method === "GET") {
          return listPrivateTemplates(req, env, pageId, responseHeaders);
        }
        if (!templateId && method === "POST") {
          return createPrivateTemplate(req, env, pageId, responseHeaders);
        }
        if (templateId && !actionNext && method === "DELETE") {
          return deletePrivateTemplate(req, env, pageId, templateId, responseHeaders);
        }
        if (templateId && actionNext === "links" && method === "POST") {
          return issuePrivateLinkFromTemplate(req, env, pageId, templateId, responseHeaders);
        }
      }
    }

    return errorResponse("Not Found", 404, responseHeaders);

    } catch (err: any) {
      logEvent("error", "Worker Runtime Error", { error: err?.message || err });
      return new Response(
        JSON.stringify({
          error: "Worker Runtime Error",
          message: err?.message || "Unexpected error",
          requestId,
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...responseHeaders,
          },
        }
      );
    }
  },
  async scheduled(_event: ScheduledEvent, env: any, ctx: ExecutionContext) {
    ctx.waitUntil(prunePrivateLinks(env));
  },
};
