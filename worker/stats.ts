type PageStats = {
  views: number;
  admin_views: number;
};

function parseStats(raw: string | null): PageStats {
  if (!raw) return { views: 0, admin_views: 0 };
  try {
    const parsed = JSON.parse(raw);
    return {
      views: Number(parsed?.views ?? 0),
      admin_views: Number(parsed?.admin_views ?? 0),
    };
  } catch (error) {
    return { views: 0, admin_views: 0 };
  }
}

export async function recordPageView(env: any, pageId: string, isAdmin: boolean) {
  const data = await env.PAGE_KV.get(`page_stats:${pageId}`);
  const pageStats = parseStats(data);

  if (isAdmin) {
    pageStats.admin_views += 1;
  } else {
    pageStats.views += 1;
  }

  await env.PAGE_KV.put(`page_stats:${pageId}`, JSON.stringify(pageStats));
  return pageStats;
}

export async function getPageStats(env: any, pageId: string): Promise<PageStats | null> {
  const data = await env.PAGE_KV.get(`page_stats:${pageId}`);
  if (!data) return null;
  return parseStats(data);
}

export async function incView(req: Request, env: any, pageId: string) {
  await recordPageView(env, pageId, false);
  return new Response("View incremented");
}

export async function getStats(req: Request, env: any, pageId: string) {
  const pageStats = await getPageStats(env, pageId);
  if (!pageStats) {
    return new Response("Stats not found", { status: 404 });
  }
  return new Response(JSON.stringify(pageStats));
}
