export type PlanAction = "create_page" | "update_slug" | "create_private_link";

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
};

export async function getPlanLimits(env: any, planId?: string | null): Promise<PlanLimitRow> {
  const effectivePlanId = (planId || "default").trim() || "default";
  const row = await env.DB.prepare(
    "SELECT plan_id, can_create_pages, can_change_slug, can_create_private_links FROM plan_limits WHERE plan_id = ? LIMIT 1"
  )
    .bind(effectivePlanId)
    .first<PlanLimitRow>();

  return (
    row || {
      plan_id: effectivePlanId,
      can_create_pages: 1,
      can_change_slug: 1,
      can_create_private_links: 1,
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
