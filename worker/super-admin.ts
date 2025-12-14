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
