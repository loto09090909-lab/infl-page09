const DAY_MS = 24 * 60 * 60 * 1000;

export type DailyStats = {
  day: string;
  views: number;
  adminViews: number;
  privateViews: number;
  contactSubmissions: number;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function clampDays(days: number) {
  if (!Number.isFinite(days) || days <= 0) return 30;
  return Math.min(180, Math.floor(days));
}

export async function recordPageView(
  env: any,
  pageId: string,
  options: { isAdmin?: boolean; isPrivate?: boolean } = {}
) {
  const day = today();

  const views = options.isAdmin ? 0 : 1;
  const adminViews = options.isAdmin ? 1 : 0;
  const privateViews = options.isPrivate ? 1 : 0;

  await env.DB.prepare(
    "INSERT INTO page_stats (page_id, day, views, admin_views, private_views, contact_submissions) VALUES (?, ?, ?, ?, ?, 0) " +
      "ON CONFLICT(page_id, day) DO UPDATE SET views = views + excluded.views, admin_views = admin_views + excluded.admin_views, " +
      "private_views = private_views + excluded.private_views"
  )
    .bind(pageId, day, views, adminViews, privateViews)
    .run();
}

export async function recordContactSubmission(env: any, pageId: string) {
  const day = today();

  await env.DB.prepare(
    "INSERT INTO page_stats (page_id, day, views, admin_views, private_views, contact_submissions) VALUES (?, ?, 0, 0, 0, 1) " +
      "ON CONFLICT(page_id, day) DO UPDATE SET contact_submissions = contact_submissions + 1"
  )
    .bind(pageId, day)
    .run();
}

export async function getPageStats(env: any, pageId: string, days: number = 30) {
  const windowDays = clampDays(days);
  const cutoff = new Date(Date.now() - windowDays * DAY_MS).toISOString().slice(0, 10);

  const rows = await env.DB.prepare(
    "SELECT day, views, admin_views, private_views, contact_submissions FROM page_stats WHERE page_id = ? AND day >= ? ORDER BY day DESC"
  )
    .bind(pageId, cutoff)
    .all<{
      day: string;
      views: number;
      admin_views: number;
      private_views: number;
      contact_submissions: number;
    }>();

  const results = rows?.results ?? [];

  const totals = results.reduce(
    (acc, row) => {
      acc.views += row.views ?? 0;
      acc.adminViews += row.admin_views ?? 0;
      acc.privateViews += row.private_views ?? 0;
      acc.contactSubmissions += row.contact_submissions ?? 0;
      return acc;
    },
    { views: 0, adminViews: 0, privateViews: 0, contactSubmissions: 0 }
  );

  const daily: DailyStats[] = results.map((row) => ({
    day: row.day,
    views: row.views ?? 0,
    adminViews: row.admin_views ?? 0,
    privateViews: row.private_views ?? 0,
    contactSubmissions: row.contact_submissions ?? 0,
  }));

  return { totals, daily };
}
