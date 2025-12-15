import { json } from "./utils";  // 공통 JSON 유틸리티

// 슈퍼 관리자 로그인 처리
export async function superAdminLogin(req: Request, env: any): Promise<Response> {
  const { password } = await req.json();
  const storedPassword = await env.PAGE_KV.get("super_admin_password");

  if (storedPassword !== password) {
    return new Response("Unauthorized", { status: 401 });
  }

  return new Response("Login successful");
}

// 페이지 생성
export async function createPage(req: Request, env: any): Promise<Response> {
  const { pageId, profile, adminPassword, plan } = await req.json();

  // 페이지 데이터 및 관리자 비밀번호 저장
  const pageData = { profile, plan };
  await env.PAGE_KV.put(`page:${pageId}`, JSON.stringify(pageData));  // 페이지 데이터 저장
  await env.PAGE_KV.put(`page_auth:${pageId}`, adminPassword);  // 관리자 비밀번호 저장

  return json({ success: true, message: "Page created successfully" });
}

// 페이지 목록 조회
export async function listPages(env: any): Promise<Response> {
  // 페이지 목록을 가져와서 반환
  const keys = await env.PAGE_KV.list({ prefix: "page:" });
  const pages = await Promise.all(
    keys.keys.map(async (key) => {
      const data = await env.PAGE_KV.get(key.name);
      return JSON.parse(data!);  // 페이지 데이터를 JSON 형식으로 반환
    })
  );

  return json(pages);  // 페이지 목록 반환
}

// 페이지 삭제
export async function deletePage(req: Request, env: any, pageId: string): Promise<Response> {
  const exists = await env.PAGE_KV.get(`page:${pageId}`);

  // 페이지가 존재하지 않으면 404 반환
  if (!exists) {
    return new Response("Page not found", { status: 404 });
  }

  // 페이지 삭제
  await env.PAGE_KV.delete(`page:${pageId}`);
  await env.PAGE_KV.delete(`page_auth:${pageId}`);

  return json({ success: true, message: "Page deleted successfully" });
}

// 페이지 수정 (수정 기능)
export async function updatePage(req: Request, env: any, pageId: string): Promise<Response> {
  const { profile, plan } = await req.json();
  const existingPage = await env.PAGE_KV.get(`page:${pageId}`);

  // 페이지가 존재하지 않으면 404 반환
  if (!existingPage) {
    return new Response("Page not found", { status: 404 });
  }

  const updatedPage = { profile, plan };
  await env.PAGE_KV.put(`page:${pageId}`, JSON.stringify(updatedPage));

  return json({ success: true, message: "Page updated successfully" });
}
