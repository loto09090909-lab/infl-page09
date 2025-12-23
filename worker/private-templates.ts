import { getBearerToken, verifySessionToken } from "./auth";
import { resolvePageId } from "./slug";
import { errorResponse, jsonResponse, parseJsonBody } from "./utils";
import { countActivePrivateLinks, createPrivateLinkRecord } from "./private-links";
import { enforcePlanLimit, enforcePrivateLinkLimit, getPagePlanId, PlanLimitError } from "./plan-limits";

type TemplatePayload = {
  expiresAt?: string;
  maxUses?: number;
  note?: string;
};

function sanitizeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function normalizePayload(raw: unknown): TemplatePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const payload = raw as TemplatePayload;
  const maxUses = payload.maxUses ? Number(payload.maxUses) : undefined;
  return {
    ...(payload.expiresAt ? { expiresAt: String(payload.expiresAt).slice(0, 40) } : {}),
    ...(Number.isFinite(maxUses) && maxUses! > 0 ? { maxUses: Math.floor(maxUses!) } : {}),
    ...(payload.note ? { note: String(payload.note).slice(0, 120) } : {}),
  };
}

async function requirePageAdmin(req: Request, env: any, pageId: string, headers: HeadersInit) {
  const token = getBearerToken(req);
  const canonicalPageId = await resolvePageId(env, pageId);
  const pageTokenValid = await verifySessionToken(env, "page", token, canonicalPageId);
  const superTokenValid = await verifySessionToken(env, "super", token);
  if (!pageTokenValid && !superTokenValid) {
    return { error: errorResponse("페이지 관리자 인증이 필요합니다", 401, headers) } as const;
  }
  return { pageId: canonicalPageId } as const;
}

export async function listPrivateTemplates(
  req: Request,
  env: any,
  pageId: string,
  headers: HeadersInit
) {
  const auth = await requirePageAdmin(req, env, pageId, headers);
  if ("error" in auth) return auth.error;

  const rows = await env.DB.prepare(
    "SELECT id, name, payload, created_at FROM private_templates WHERE page_id = ? ORDER BY created_at DESC"
  )
    .bind(auth.pageId)
    .all<{ id: string; name: string; payload: string | null; created_at: string }>();

  const items = (rows?.results ?? []).map((row) => {
    let payload: TemplatePayload | null = null;
    if (row.payload) {
      try {
        payload = JSON.parse(row.payload);
      } catch (error) {
        payload = null;
      }
    }
    return {
      id: row.id,
      name: row.name,
      payload,
      createdAt: row.created_at,
    };
  });

  return jsonResponse({ items }, 200, headers);
}

export async function createPrivateTemplate(
  req: Request,
  env: any,
  pageId: string,
  headers: HeadersInit
) {
  const auth = await requirePageAdmin(req, env, pageId, headers);
  if ("error" in auth) return auth.error;

  const body = await parseJsonBody<{ name?: string; payload?: TemplatePayload }>(req);
  const name = sanitizeString(body?.name, 120);
  if (!name) {
    return errorResponse("템플릿 이름이 필요합니다", 400, headers);
  }

  const payload = normalizePayload(body?.payload);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO private_templates (id, page_id, name, payload) VALUES (?, ?, ?, ?)"
  )
    .bind(id, auth.pageId, name, payload ? JSON.stringify(payload) : null)
    .run();

  return jsonResponse({ id, name, payload }, 201, headers);
}

export async function deletePrivateTemplate(
  req: Request,
  env: any,
  pageId: string,
  templateId: string,
  headers: HeadersInit
) {
  const auth = await requirePageAdmin(req, env, pageId, headers);
  if ("error" in auth) return auth.error;

  await env.DB.prepare(
    "DELETE FROM private_templates WHERE id = ? AND page_id = ?"
  )
    .bind(templateId, auth.pageId)
    .run();

  return jsonResponse({ success: true }, 200, headers);
}

export async function issuePrivateLinkFromTemplate(
  req: Request,
  env: any,
  pageId: string,
  templateId: string,
  headers: HeadersInit
) {
  const auth = await requirePageAdmin(req, env, pageId, headers);
  if ("error" in auth) return auth.error;

  const row = await env.DB.prepare(
    "SELECT payload FROM private_templates WHERE id = ? AND page_id = ? LIMIT 1"
  )
    .bind(templateId, auth.pageId)
    .first<{ payload: string | null }>();

  if (!row) {
    return errorResponse("템플릿을 찾을 수 없습니다", 404, headers);
  }

  let payload: TemplatePayload = {};
  if (row.payload) {
    try {
      payload = JSON.parse(row.payload);
    } catch (error) {
      payload = {};
    }
  }

  try {
    const planId = (await getPagePlanId(env, auth.pageId)) ?? "free";
    await enforcePlanLimit(env, planId, "create_private_link");
    const activeCount = await countActivePrivateLinks(env, auth.pageId);
    await enforcePrivateLinkLimit(env, planId, activeCount);
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return errorResponse(error.message, error.status, headers);
    }
    throw error;
  }

  const created = await createPrivateLinkRecord(env, auth.pageId, payload);
  if ("error" in created) {
    return errorResponse(created.error, 400, headers);
  }
  return jsonResponse(created, 201, headers);
}
