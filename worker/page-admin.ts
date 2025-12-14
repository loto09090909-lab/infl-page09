export async function pageAdminLogin(req: Request, env: any, pageId: string) {
  const { password } = await req.json();
  const storedPassword = await env.PAGE_KV.get(`page_auth:${pageId}`);

  if (storedPassword !== password) {
    return new Response("Unauthorized", { status: 401 });
  }

  return new Response("Login successful");
}

export async function savePage(req: Request, env: any, pageId: string) {
  const { profile, links } = await req.json();
  const pageData = { profile, links };

  await env.PAGE_KV.put(`page:${pageId}`, JSON.stringify(pageData));

  return new Response("Page saved successfully");
}
