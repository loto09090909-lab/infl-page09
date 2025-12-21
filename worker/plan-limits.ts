export type PlanAction =
  | "create_page"
  | "update_slug"
  | "create_private_link"
  | "export_csv"
  | "view_stats";

export class PlanLimitError extends Error {
  status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

export type PlanLimitRow = {
  plan_id: string;
  can_create_pages: number;
  can_change_slug: number;
  can_create_private_links: number;
  max_pages: number;
  max_private_links: number;
  max_contact_fields: number;
  can_export_csv: number;
  stats_retention_days: number;
};

export async function getPlanLimits(env: any, planId?: string | null): Promise<PlanLimitRow> {
  const effectivePlanId = (planId || "default").trim() || "default";
  let row: PlanLimitRow | null = null;
  try {
    row = await env.DB.prepare(
      "SELECT plan_id, can_create_pages, can_change_slug, can_create_private_links, max_pages, max_private_links, max_contact_fields, can_export_csv, stats_retention_days FROM plan_limits WHERE plan_id = ? LIMIT 1"
    )
      .bind(effectivePlanId)
      .first<PlanLimitRow>();
  } catch (error) {
    row = null;
  }

  return (
    row || {
      plan_id: effectivePlanId,
      can_create_pages: 1,
      can_change_slug: 1,
      can_create_private_links: 1,
      max_pages: 1,
      max_private_links: 5,
      max_contact_fields: 10,
      can_export_csv: 0,
      stats_retention_days: 30,
    }
  );
}

export async function enforcePlanLimit(env: any, planId: unknown, action: PlanAction) {
  const planLimits = await getPlanLimits(env, typeof planId === "string" ? planId : null);

  switch (action) {
    case "create_page":
      if (!planLimits.can_create_pages) {
        throw new PlanLimitError("이 플랜에서는 페이지를 생성할 수 없습니다", 403);
      }
      break;
    case "update_slug":
      if (!planLimits.can_change_slug) {
        throw new PlanLimitError("이 플랜에서는 슬러그를 변경할 수 없습니다", 403);
      }
      break;
    case "create_private_link":
      if (!planLimits.can_create_private_links) {
        throw new PlanLimitError("이 플랜에서는 프라이빗 링크를 만들 수 없습니다", 403);
      }
      break;
    case "export_csv":
      if (!planLimits.can_export_csv) {
        throw new PlanLimitError("이 플랜에서는 CSV 내보내기를 사용할 수 없습니다", 403);
      }
      break;
    case "view_stats":
      if (!planLimits.stats_retention_days || planLimits.stats_retention_days <= 0) {
        throw new PlanLimitError("이 플랜에서는 통계를 확인할 수 없습니다", 403);
      }
      break;
  }
}

export async function enforceMaxPages(
  env: any,
  planId: unknown,
  currentCount: number
) {
  const planLimits = await getPlanLimits(env, typeof planId === "string" ? planId : null);
  if (currentCount >= planLimits.max_pages) {
    throw new PlanLimitError("이 플랜에서는 추가 페이지를 생성할 수 없습니다", 403);
  }
}

export async function enforcePrivateLinkLimit(
  env: any,
  planId: unknown,
  currentCount: number
) {
  const planLimits = await getPlanLimits(env, typeof planId === "string" ? planId : null);
  if (currentCount >= planLimits.max_private_links) {
    throw new PlanLimitError("이 플랜에서는 더 이상 프라이빗 링크를 만들 수 없습니다", 403);
  }
}

export async function enforceContactFieldLimit(
  env: any,
  planId: unknown,
  fieldCount: number
) {
  const planLimits = await getPlanLimits(env, typeof planId === "string" ? planId : null);
  if (fieldCount > planLimits.max_contact_fields) {
    throw new PlanLimitError("이 플랜에서는 컨택트 필드 수를 초과했습니다", 403);
  }
}

export async function getPagePlanId(env: any, pageId: string) {
  const row = await env.DB.prepare(
    "SELECT plan_id FROM page_meta WHERE page_id = ? LIMIT 1"
  )
    .bind(pageId)
    .first<{ plan_id: string | null }>();
  if (row?.plan_id) return row.plan_id;
  const kvRaw = await env.PAGE_KV.get(`page:${pageId}`);
  if (!kvRaw) return null;
  try {
    const parsed = JSON.parse(kvRaw);
    return typeof parsed?.plan === "string" ? parsed.plan : null;
  } catch (error) {
    return null;
  }
}

export function hasPrivateLinks(rawLinks: unknown): boolean {
  if (!Array.isArray(rawLinks)) return false;

  return rawLinks.some((link) => {
    if (!link || typeof link !== "object") return false;
    const candidate = link as Record<string, unknown>;
    return candidate.private === true || candidate.isPrivate === true;
  });
}
