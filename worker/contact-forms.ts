import { getPlanLimits, PlanLimitError } from "./plan-limits";
import { resolvePageId } from "./slug";
import { jsonResponse, errorResponse, parseJsonBody } from "./utils";
import { verifyPageAccess, getPlanForPage } from "./page-admin";
import { validatePrivateLinkAccess } from "./private-links";
import { recordContactSubmission } from "./stats";

const ALLOWED_FIELD_TYPES = new Set(["text", "email", "tel", "textarea"]);

export type ContactField = {
  name: string;
  label: string;
  type: "text" | "email" | "tel" | "textarea";
  required: boolean;
  placeholder?: string;
};

type SaveContactFormBody = {
  fields?: unknown;
};

type ContactSubmissionBody = {
  values?: unknown;
  privateToken?: unknown;
  accessCode?: unknown;
};

type ContactFormRow = {
  schema_json: string;
};

type ContactSubmissionRow = {
  id: string;
  payload_json: string;
  submitted_at: string;
  private_link_id: string | null;
};

export async function getContactFormForAdmin(
  req: Request,
  env: any,
  pageId: string,
  headers: HeadersInit
): Promise<Response> {
  const access = await verifyPageAccess(req, env, pageId, headers);
  if (access.authorized !== true) return access.authorized;

  const form = await loadContactForm(env, access.canonicalPageId);
  return jsonResponse({ fields: form }, 200, headers);
}

export async function saveContactForm(
  req: Request,
  env: any,
  pageId: string,
  headers: HeadersInit
): Promise<Response> {
  const access = await verifyPageAccess(req, env, pageId, headers);
  if (access.authorized !== true) return access.authorized;

  const body = await parseJsonBody<SaveContactFormBody>(req);
  if (!body) {
    return errorResponse("잘못된 요청 본문입니다", 400, headers);
  }

  const planId = await getPlanForPage(env, access.canonicalPageId);
  const planLimits = await getPlanLimits(env, planId);

  let fields: ContactField[];
  try {
    fields = normalizeFields(body.fields, planLimits.max_contact_fields);
  } catch (error: any) {
    if (error instanceof PlanLimitError) {
      return errorResponse(error.message, error.status, headers);
    }
    return errorResponse(error?.message || "컨택트 폼을 저장할 수 없습니다", 400, headers);
  }

  await env.DB.prepare(
    "INSERT INTO contact_forms (page_id, schema_json, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now')) ON CONFLICT(page_id) DO UPDATE SET schema_json=excluded.schema_json, updated_at=datetime('now')"
  )
    .bind(access.canonicalPageId, JSON.stringify(fields))
    .run();

  return jsonResponse({ fields }, 200, headers);
}

export async function listContactSubmissions(
  req: Request,
  env: any,
  pageId: string,
  headers: HeadersInit
): Promise<Response> {
  const access = await verifyPageAccess(req, env, pageId, headers);
  if (access.authorized !== true) return access.authorized;

  const rows = await env.DB.prepare(
    "SELECT id, payload_json, submitted_at, private_link_id FROM contact_submissions WHERE page_id = ? ORDER BY submitted_at DESC LIMIT 50"
  )
    .bind(access.canonicalPageId)
    .all<ContactSubmissionRow>();

  const submissions = (rows?.results ?? []).map((row) => ({
    id: row.id,
    values: safeParseJson(row.payload_json),
    submittedAt: row.submitted_at,
    privateLinkId: row.private_link_id,
  }));

  return jsonResponse({ submissions }, 200, headers);
}

export async function submitContact(
  req: Request,
  env: any,
  pageId: string,
  headers: HeadersInit
): Promise<Response> {
  const body = await parseJsonBody<ContactSubmissionBody>(req);
  if (!body) {
    return errorResponse("잘못된 요청 본문입니다", 400, headers);
  }

  const resolvedPageId = await resolvePageId(env, pageId);
  const form = await loadContactForm(env, resolvedPageId);
  if (!form) {
    return errorResponse("컨택트 폼이 설정되지 않았습니다", 404, headers);
  }

  let privateLinkId: string | null = null;
  if (body.privateToken) {
    const token = typeof body.privateToken === "string" ? body.privateToken : null;
    const accessCode =
      typeof body.accessCode === "string" || body.accessCode === null
        ? body.accessCode
        : null;
    if (!token) {
      return errorResponse("유효한 프라이빗 링크 토큰이 필요합니다", 400, headers);
    }

    const validation = await validatePrivateLinkAccess(env, token, accessCode);
    if ("error" in validation) {
      return errorResponse(validation.error, validation.status, headers);
    }

    if (validation.pageId !== resolvedPageId) {
      return errorResponse("이 페이지의 프라이빗 링크가 아닙니다", 403, headers);
    }

    privateLinkId = validation.privateLinkId;
  }

  let values: Record<string, string>;
  try {
    values = normalizeSubmissionValues(body.values, form);
  } catch (error: any) {
    return errorResponse(error?.message || "제출 형식이 올바르지 않습니다", 400, headers);
  }

  await env.DB.prepare(
    "INSERT INTO contact_submissions (id, page_id, private_link_id, payload_json, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(
      crypto.randomUUID(),
      resolvedPageId,
      privateLinkId,
      JSON.stringify(values),
      req.headers.get("CF-Connecting-IP") ?? null,
      req.headers.get("User-Agent") ?? null
    )
    .run();

  await recordContactSubmission(env, resolvedPageId);

  return jsonResponse({ success: true }, 201, headers);
}

export async function getPublicContactForm(env: any, pageId: string) {
  return loadContactForm(env, pageId);
}

function normalizeFields(raw: unknown, maxFields: number): ContactField[] {
  if (!Array.isArray(raw)) {
    throw new Error("fields 배열을 입력하세요");
  }

  const seen = new Set<string>();
  const fields: ContactField[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;

    const name = normalizeName(candidate.name);
    if (!name || seen.has(name)) continue;

    const label = normalizeLabel(candidate.label, name);
    const type = normalizeType(candidate.type);
    const required = candidate.required === true;
    const placeholder = normalizePlaceholder(candidate.placeholder);

    fields.push({ name, label, type, required, ...(placeholder ? { placeholder } : {}) });
    seen.add(name);
  }

  if (!fields.length) {
    throw new Error("최소 1개 이상의 필드를 정의하세요");
  }

  if (maxFields && fields.length > maxFields) {
    throw new PlanLimitError(
      `이 플랜에서는 최대 ${maxFields}개의 필드만 설정할 수 있습니다`,
      403
    );
  }

  return fields;
}

function normalizeName(raw: unknown) {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.slice(0, 64);
}

function normalizeLabel(raw: unknown, fallback: string) {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, 100);
}

function normalizeType(raw: unknown): ContactField["type"] {
  if (typeof raw === "string" && ALLOWED_FIELD_TYPES.has(raw)) {
    return raw as ContactField["type"];
  }
  return "text";
}

function normalizePlaceholder(raw: unknown) {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 200);
}

function normalizeSubmissionValues(
  values: unknown,
  schema: ContactField[]
): Record<string, string> {
  if (!values || typeof values !== "object") {
    throw new Error("values 객체를 입력하세요");
  }

  const payload: Record<string, string> = {};
  const valueMap = values as Record<string, unknown>;

  for (const field of schema) {
    const raw = valueMap[field.name];
    const normalized = normalizeValue(raw, field.type);

    if (field.required && !normalized) {
      throw new Error(`${field.label} 값을 입력하세요`);
    }

    if (normalized) {
      payload[field.name] = normalized;
    }
  }

  return payload;
}

function normalizeValue(raw: unknown, type: ContactField["type"]): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "number" || typeof raw === "boolean") {
    raw = String(raw);
  }

  if (typeof raw !== "string") return "";

  const trimmed = raw.trim();
  if (!trimmed) return "";

  if (type === "textarea") {
    return trimmed.slice(0, 2000);
  }

  return trimmed.slice(0, 300);
}

async function loadContactForm(env: any, pageId: string): Promise<ContactField[] | null> {
  const row = await env.DB.prepare(
    "SELECT schema_json FROM contact_forms WHERE page_id = ? LIMIT 1"
  )
    .bind(pageId)
    .first<ContactFormRow>();

  if (!row) return null;
  return safeParseJson(row.schema_json);
}

function safeParseJson(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}
