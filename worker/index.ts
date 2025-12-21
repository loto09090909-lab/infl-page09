import { getBearerToken, verifySessionToken } from "./auth";
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
import { buildCorsHeaders, CorsOptions, errorResponse, jsonResponse } from "./utils";
import { login as userLogin, signup as userSignup, deleteUserById, deleteUserByEmail } from "./users";
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
import { createRandomPrivateLink, getPrivatePage } from "./private-links";
import { startOAuth, handleOAuthCallback } from "./oauth";

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

    if (
      method === "GET" &&
      path.startsWith("/api/pages/") &&
      !path.includes("/private/") &&
      !path.endsWith("/random")
    ) {
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

    if (method === "GET" && path.startsWith("/api/auth/")) {
      const match = path.match(/^\/api\/auth\/([^/]+)\/start$/);
      if (match) {
        const provider = match[1];
        return startOAuth(req, env, corsHeaders, provider);
      }
    }

    if (method === "GET" && path.startsWith("/api/auth/")) {
      const match = path.match(/^\/api\/auth\/([^/]+)\/callback$/);
      if (match) {
        const provider = match[1];
        return handleOAuthCallback(req, env, corsHeaders, provider);
      }
    }

    // --- 사용자 가입/로그인 ---
    if (method === "POST" && path === "/api/users/signup") {
      return userSignup(req, env, corsHeaders);
    }

    if (method === "POST" && path === "/api/users/login") {
      return userLogin(req, env, corsHeaders);
    }

    if (method === "DELETE" && path === "/api/users/by-email") {
      const token = getBearerToken(req);
      const isAdmin = await verifySessionToken(env, "super", token);
      if (!isAdmin) {
        return errorResponse("슈퍼 관리자 인증이 필요합니다", 401, corsHeaders);
      }
      const email = url.searchParams.get("email") || "";
      return deleteUserByEmail(env, corsHeaders, email);
    }

    const userDeleteMatch = path.match(/^\/api\/users\/(.+)$/);
    if (method === "DELETE" && userDeleteMatch) {
      const userId = decodeURIComponent(userDeleteMatch[1]);
      const token = getBearerToken(req);
      const isAdmin = await verifySessionToken(env, "super", token);
      if (!isAdmin) {
        return errorResponse("슈퍼 관리자 인증이 필요합니다", 401, corsHeaders);
      }
      return deleteUserById(env, corsHeaders, userId);
    }

    if (method === "GET" && path.startsWith("/api/pages/") && path.includes("/private/")) {
      const match = path.match(/^\/api\/pages\/(.+)\/private\/(.+)$/);
      if (!match) {
        return errorResponse("Not Found", 404, corsHeaders);
      }
      const pageId = decodeURIComponent(match[1]);
      const token = decodeURIComponent(match[2]);
      return getPrivatePage(req, env, corsHeaders, pageId, token);
    }

    if (method === "GET" && path.startsWith("/api/pages/") && path.endsWith("/random")) {
      const match = path.match(/^\/api\/pages\/(.+)\/random$/);
      if (!match) {
        return errorResponse("Not Found", 404, corsHeaders);
      }
      const pageId = decodeURIComponent(match[1]);
      return createRandomPrivateLink(req, env, corsHeaders, pageId);
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

    const userPrivateMatch = path.match(/^\/api\/user\/pages\/(.+)\/private-links$/);
    if (userPrivateMatch) {
      const pageId = decodeURIComponent(userPrivateMatch[1]);
      if (method === "POST") {
        return createUserPrivateLink(req, env, corsHeaders, pageId);
      }
      if (method === "GET") {
        return listUserPrivateLinks(req, env, corsHeaders, pageId);
      }
    }

    const userPrivateTokenMatch = path.match(/^\/api\/user\/pages\/(.+)\/private-links\/(.+)$/);
    if (userPrivateTokenMatch) {
      const pageId = decodeURIComponent(userPrivateTokenMatch[1]);
      const token = decodeURIComponent(userPrivateTokenMatch[2]);
      if (method === "DELETE") {
        return deleteUserPrivateLink(req, env, corsHeaders, pageId, token);
      }
    }

    const userMembersMatch = path.match(/^\/api\/user\/pages\/(.+)\/members$/);
    if (userMembersMatch) {
      const pageId = decodeURIComponent(userMembersMatch[1]);
      if (method === "GET") {
        return listUserPageMembers(req, env, corsHeaders, pageId);
      }
    }

    const userMemberMatch = path.match(/^\/api\/user\/pages\/(.+)\/members\/(.+)$/);
    if (userMemberMatch) {
      const pageId = decodeURIComponent(userMemberMatch[1]);
      const memberUserId = decodeURIComponent(userMemberMatch[2]);
      if (method === "DELETE") {
        return removeUserPageMember(req, env, corsHeaders, pageId, memberUserId);
      }
    }

    const userInvitesMatch = path.match(/^\/api\/user\/pages\/(.+)\/invites$/);
    if (userInvitesMatch) {
      const pageId = decodeURIComponent(userInvitesMatch[1]);
      if (method === "POST") {
        return createUserPageInvite(req, env, corsHeaders, pageId);
      }
      if (method === "GET") {
        return listUserPageInvites(req, env, corsHeaders, pageId);
      }
    }

    const userInviteMatch = path.match(/^\/api\/user\/pages\/(.+)\/invites\/(.+)$/);
    if (userInviteMatch) {
      const pageId = decodeURIComponent(userInviteMatch[1]);
      const token = decodeURIComponent(userInviteMatch[2]);
      if (method === "DELETE") {
        return revokeUserPageInvite(req, env, corsHeaders, pageId, token);
      }
    }

    const userInviteAcceptMatch = path.match(/^\/api\/user\/invites\/(.+)\/accept$/);
    if (userInviteAcceptMatch && method === "POST") {
      const token = decodeURIComponent(userInviteAcceptMatch[1]);
      return acceptUserInvite(req, env, corsHeaders, token);
    }

    const userContactMatch = path.match(/^\/api\/user\/pages\/(.+)\/contact-submissions$/);
    if (userContactMatch) {
      const pageId = decodeURIComponent(userContactMatch[1]);
      if (method === "GET") {
        return listUserPageContactSubmissions(req, env, corsHeaders, pageId);
      }
      if (method === "DELETE") {
        return deleteUserPageContactSubmissions(req, env, corsHeaders, pageId);
      }
    }

    const userContactCsvMatch = path.match(/^\/api\/user\/pages\/(.+)\/contact-submissions\.csv$/);
    if (userContactCsvMatch && method === "GET") {
      const pageId = decodeURIComponent(userContactCsvMatch[1]);
      return exportUserPageContactSubmissions(req, env, corsHeaders, pageId);
    }

    const userStatsMatch = path.match(/^\/api\/user\/pages\/(.+)\/stats$/);
    if (userStatsMatch && method === "GET") {
      const pageId = decodeURIComponent(userStatsMatch[1]);
      return getUserPageStats(req, env, corsHeaders, pageId);
    }

    const userPlanStatusMatch = path.match(/^\/api\/user\/pages\/(.+)\/plan-status$/);
    if (userPlanStatusMatch && method === "GET") {
      const pageId = decodeURIComponent(userPlanStatusMatch[1]);
      return getUserPagePlanStatus(req, env, corsHeaders, pageId);
    }

    const userAccessCodeMatch = path.match(/^\/api\/user\/pages\/(.+)\/access-code\/rotate$/);
    if (userAccessCodeMatch && method === "POST") {
      const pageId = decodeURIComponent(userAccessCodeMatch[1]);
      return rotateUserAccessCode(req, env, corsHeaders, pageId);
    }

    const userAccessCodeDisableMatch = path.match(/^\/api\/user\/pages\/(.+)\/access-code\/disable$/);
    if (userAccessCodeDisableMatch && method === "POST") {
      const pageId = decodeURIComponent(userAccessCodeDisableMatch[1]);
      return disableUserAccessCode(req, env, corsHeaders, pageId);
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

      if (method === "POST" && action === "access-code" && pathSegments[4] === "rotate") {
        return rotateAccessCode(req, env, pageId, corsHeaders);
      }

      if (method === "POST" && action === "access-code" && pathSegments[4] === "disable") {
        return disableAccessCode(req, env, pageId, corsHeaders);
      }

      if (method === "GET" && action === "contact-submissions") {
        const { listContactSubmissions } = await import("./contact");
        return listContactSubmissions(req, env, pageId, corsHeaders);
      }

      if (method === "DELETE" && action === "contact-submissions") {
        const { deleteContactSubmissions } = await import("./contact");
        return deleteContactSubmissions(req, env, pageId, corsHeaders);
      }

      if (method === "GET" && action === "contact-submissions.csv") {
        const { exportContactSubmissions } = await import("./contact");
        return exportContactSubmissions(req, env, pageId, corsHeaders);
      }

      if (method === "GET" && action === "plan-status") {
        const { getPagePlanStatus } = await import("./page-admin");
        return getPagePlanStatus(req, env, pageId, corsHeaders);
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
          return listPrivateTemplates(req, env, pageId, corsHeaders);
        }
        if (!templateId && method === "POST") {
          return createPrivateTemplate(req, env, pageId, corsHeaders);
        }
        if (templateId && !actionNext && method === "DELETE") {
          return deletePrivateTemplate(req, env, pageId, templateId, corsHeaders);
        }
        if (templateId && actionNext === "links" && method === "POST") {
          return issuePrivateLinkFromTemplate(req, env, pageId, templateId, corsHeaders);
        }
      }
    }

    return errorResponse("Not Found", 404, corsHeaders);

    } catch (err: any) {
      console.error("Worker Runtime Error", err);
      return new Response(
        JSON.stringify({
          error: "Worker Runtime Error",
          message: err?.message || "Unexpected error",
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
  },
};
