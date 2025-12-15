export async function superAdminLogin(req: Request, env: any) {
  const { password } = await req.json();
  const storedPassword = await env.PAGE_KV.get("super_admin_password");

  if (storedPassword !== password) {
    return new Response("Unauthorized", { status: 401 });
  }

  return new Response("Login successful");
}

export async function createPage(req: Request, env: any) {
  const { pageId, profile, adminPassword } = await req.json();

  // 데이터 검증 및 저장 로직
  await env.PAGE_KV.put(`page:${pageId}`, JSON.stringify({ profile }));
  await env.PAGE_KV.put(`page_auth:${pageId}`, adminPassword);

  return new Response("Page created successfully");
}

export async function listPages(env: any) {
  const pages = await env.PAGE_KV.list();
  return pages.keys.map((key: any) => key.name.replace("page:", ""));
}

import { json } from "./utils";

// 페이지 생성
export async function createPage(req: Request, env: any): Promise<Response> {
    const { pageId, profile, adminPassword, plan } = await req.json();
  
    // KV에 페이지 저장
    const pageData = { profile, plan };
    await env.PAGE_KV.put(`page:${pageId}`, JSON.stringify(pageData));

    return json({ success: true, message: "Page created successfully" });
}

// 페이지 목록 조회
export async function listPages(env: any): Promise<Response> {
    const keys = await env.PAGE_KV.list({ prefix: "page:" });
    const pages = await Promise.all(
        keys.keys.map(async key => {
            const data = await env.PAGE_KV.get(key.name);
            return JSON.parse(data!);
        })
    );
    
    return json(pages);
}

// 페이지 삭제
export async function deletePage(req: Request, env: any, pageId: string): Promise<Response> {
    const exists = await env.PAGE_KV.get(`page:${pageId}`);
    
    if (!exists) {
        return new Response("Page not found", { status: 404 });
    }

    await env.PAGE_KV.delete(`page:${pageId}`);
    return json({ success: true, message: "Page deleted successfully" });
}

// 페이지 삭제
export async function deletePage(req: Request, env: any, pageId: string): Promise<Response> {
    const exists = await env.PAGE_KV.get(`page:${pageId}`);
    
    if (!exists) {
        return new Response("Page not found", { status: 404 });
    }

    await env.PAGE_KV.delete(`page:${pageId}`);
    return json({ success: true, message: "Page deleted successfully" });
}
