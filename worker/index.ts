import { json, html } from "./utils";
import { superAdminLogin, createPage, listPages } from "./super-admin";
import { pageAdminLogin, savePage } from "./page-admin";
import { incView, getStats } from "./stats";
import { locked, fail, clear } from "./login-guard";

export default {
  async fetch(req: Request, env: any) {
    const url = new URL(req.url);
    const path = url.pathname;

    // 슈퍼 관리자 로그인
    if (req.method === "POST" && path === "/api/admin/login") {
      return superAdminLogin(req, env);
    }

    // 페이지 생성
    if (req.method === "POST" && path === "/api/admin/pages") {
      return createPage(req, env);
    }

    // 페이지 목록 조회
    if (req.method === "GET" && path === "/api/admin/pages") {
      return json(await listPages(env));
    }

    // 페이지 관리자 로그인
    if (req.method === "POST" && path.endsWith("/login")) {
      const pageId = path.split("/")[3];
      return pageAdminLogin(req, env, pageId);
    }

    // 페이지 수정
    if (req.method === "POST" && path.endsWith("/save")) {
      const pageId = path.split("/")[3];
      return savePage(req, env, pageId);
    }

    // 퍼블릭 페이지 조회
    if (req.method === "GET" && path !== "/") {
      const pageId = path.slice(1);
      const data = await env.PAGE_KV.get(`page:${pageId}`);

      if (!data) return new Response("Not Found", { status: 404 });

      const page = JSON.parse(data);

      return html(`
        <h1>${page.profile.name}</h1>
        <p>${page.profile.description}</p>
      `);
    }

    return new Response("Not Found", { status: 404 });
  }
};
