export async function incView(req: Request, env: any, pageId: string) {
  const data = await env.PAGE_KV.get(`page_stats:${pageId}`);

  const pageStats = data ? JSON.parse(data) : { views: 0, admin_views: 0 };

  pageStats.views += 1;

  await env.PAGE_KV.put(`page_stats:${pageId}`, JSON.stringify(pageStats));

  return new Response("View incremented");
}

export async function getStats(req: Request, env: any, pageId: string) {
  const data = await env.PAGE_KV.get(`page_stats:${pageId}`);

  if (!data) {
    return new Response("Stats not found", { status: 404 });
  }

  const pageStats = JSON.parse(data);
  return new Response(JSON.stringify(pageStats));
}
