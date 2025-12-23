import { getBearerToken, verifySessionToken } from "./auth";
import { resolvePageId } from "./slug";
import { errorResponse, errorResponseWithCode, jsonResponse } from "./utils";
import { enforcePlanLimit, getPagePlanId, PlanLimitError } from "./plan-limits";

type ContactField = {
  label: string;
  type: string;
  placeholder?: string;
  helpText?: string;
  required?: boolean;
  options?: string[];
};

type ContactSettings = {
  webhookUrl?: string;
  webhookUrls?: string[];
  enabled?: boolean;
  formTitle?: string;
  formDescription?: string;
  consentText?: string;
  consentRequired?: boolean;
};

type ContactSubmission = {
  id: string;
  pageId: string;
  submittedAt: string;
  answers: { label: string; type: string; value: string }[];
  consentChecked?: boolean;
  ip?: string | null;
  userAgent?: string | null;
};

const MAX_FIELD_LENGTH = 2000;
const MAX_SUBMISSIONS_PER_PAGE = 200;
const DEFAULT_RATE_LIMIT = 5;
const DEFAULT_RATE_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_CONTACT_RETENTION_DAYS = 180;

function sanitizeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

const ALLOWED_CONTACT_TYPES = new Set([
  "text",
  "email",
  "tel",
  "url",
  "textarea",
  "select",
  "checkbox",
]);

async function readContactSchema(env: any, pageId: string): Promise<{
  schema: ContactField[];
  settings: ContactSettings;
  accessControl: { enabled?: boolean; code?: string };
}> {
  const kvRaw = await env.PAGE_KV.get(`page:${pageId}`);
  if (!kvRaw) return { schema: [], settings: {}, accessControl: { enabled: false } };
  try {
    const parsed = JSON.parse(kvRaw);
    const schema = Array.isArray(parsed?.contactSchema)
      ? parsed.contactSchema
          .filter((field: any) => field && typeof field === "object")
          .map((field: any) => {
            const label = sanitizeString(field.label, 120);
            const type = sanitizeString(field.type, 30);
            if (!label || !type || !ALLOWED_CONTACT_TYPES.has(type)) return null;

            const placeholder = sanitizeString(field.placeholder, 200);
            const helpText = sanitizeString(field.helpText, 400);
            const required = field.required === true;
            const options = Array.isArray(field.options)
              ? field.options
                  .map((opt: unknown) => sanitizeString(opt, 200))
                  .filter((opt: string | undefined): opt is string => !!opt)
                  .slice(0, 50)
              : [];

            if ((type === "select" || type === "checkbox") && options.length === 0) return null;

              return {
                label,
                type,
                ...(placeholder ? { placeholder } : {}),
                ...(helpText ? { helpText } : {}),
                ...(required ? { required: true } : {}),
                ...(options.length ? { options } : {}),
              } satisfies ContactField;
            })
            .filter(Boolean)
      : [];
    const settings: ContactSettings = { enabled: false };
    if (parsed?.contactSettings && typeof parsed.contactSettings === "object") {
      const webhookUrl = typeof parsed.contactSettings.webhookUrl === "string"
        ? parsed.contactSettings.webhookUrl.trim()
        : "";
      const webhookUrls = Array.isArray(parsed.contactSettings.webhookUrls)
        ? parsed.contactSettings.webhookUrls
            .map((url: unknown) => (typeof url === "string" ? url.trim() : ""))
            .filter((url: string) => !!url && (url.startsWith("http://") || url.startsWith("https://")))
            .slice(0, 5)
        : [];
      if (webhookUrl && (webhookUrl.startsWith("http://") || webhookUrl.startsWith("https://"))) {
        settings.webhookUrl = webhookUrl;
      }
      if (webhookUrls.length) {
        settings.webhookUrls = webhookUrls;
      }

      settings.enabled = parsed.contactSettings.enabled === true;
      const formTitle = typeof parsed.contactSettings.formTitle === "string"
        ? parsed.contactSettings.formTitle.trim()
        : "";
      if (formTitle) settings.formTitle = formTitle.slice(0, 120);

      const formDescription = typeof parsed.contactSettings.formDescription === "string"
        ? parsed.contactSettings.formDescription.trim()
        : "";
      if (formDescription) settings.formDescription = formDescription.slice(0, 400);

      const consentText = typeof parsed.contactSettings.consentText === "string"
        ? parsed.contactSettings.consentText.trim()
        : "";
      if (consentText) settings.consentText = consentText.slice(0, 200);

      settings.consentRequired = parsed.contactSettings.consentRequired === true;
    }
    const accessControl =
      parsed?.accessControl && typeof parsed.accessControl === "object"
        ? parsed.accessControl
        : { enabled: false };
    return { schema, settings, accessControl };
  } catch (error) {
    return { schema: [], settings: { enabled: false }, accessControl: { enabled: false } };
  }
}

async function hashString(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function checkSubmissionThrottle(
  env: any,
  pageId: string,
  ip: string | null,
  userAgent: string | null
) {
  if (!ip) return;

  const uaHash = userAgent ? await hashString(userAgent) : "na";
  const key = `contact:throttle:${pageId}:${ip}:${uaHash.slice(0, 16)}`;
  const now = Date.now();
  const windowMs = Number(env.CONTACT_THROTTLE_WINDOW_MS) || DEFAULT_RATE_WINDOW_MS;
  const limit = Number(env.CONTACT_THROTTLE_MAX) || DEFAULT_RATE_LIMIT;

  let count = 0;
  let resetAt = now + windowMs;

  const raw = await env.PAGE_KV.get(key);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { count?: number; resetAt?: number };
      count = typeof parsed.count === "number" ? parsed.count : 0;
      resetAt = typeof parsed.resetAt === "number" ? parsed.resetAt : resetAt;
    } catch (error) {
      count = 0;
    }
  }

  if (resetAt < now) {
    count = 0;
    resetAt = now + windowMs;
  }

  if (count >= limit) {
    const waitSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
    throw new Error(`제출이 너무 잦습니다. ${waitSeconds}초 후 다시 시도해주세요.`);
  }

  count += 1;
  await env.PAGE_KV.put(key, JSON.stringify({ count, resetAt }), { expirationTtl: Math.ceil((resetAt - now) / 1000) });
}

async function verifyTurnstile(
  env: any,
  token: string | undefined,
  ip: string | null
) {
  const secret = env.TURNSTILE_SECRET;
  if (!secret) return true;
  if (!token) return false;

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (ip) {
    body.set("remoteip", ip);
  }

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) return false;
  const data = await res.json<{ success?: boolean }>();
  return data?.success === true;
}

async function forwardSubmission(
  env: any,
  submission: ContactSubmission,
  settings: ContactSettings
) {
  const urls = [
    settings.webhookUrl,
    ...(settings.webhookUrls ?? []),
    env.CONTACT_WEBHOOK_URL,
  ].filter(Boolean) as string[];
  const targets = Array.from(new Set(urls)).filter(
    (url) => url.startsWith("http://") || url.startsWith("https://")
  );
  if (!targets.length) {
    return;
  }

  await Promise.all(
    targets.map(async (url) => {
      try {
        await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            pageId: submission.pageId,
            submittedAt: submission.submittedAt,
            answers: submission.answers,
            consentChecked: submission.consentChecked === true,
            ip: submission.ip,
            userAgent: submission.userAgent,
            id: submission.id,
          }),
        });
      } catch (error) {
        console.error("contact webhook failed", { url, error });
      }
    })
  );
}

async function storeSubmission(env: any, submission: ContactSubmission) {
  const indexKey = `contact:${submission.pageId}:index`;
  const submissionKey = `contact:${submission.pageId}:${submission.id}`;

  const existingIndexRaw = await env.PAGE_KV.get(indexKey);
  const index = existingIndexRaw ? (JSON.parse(existingIndexRaw) as string[]) : [];

  index.push(submission.id);
  const trimmedIndex = index.slice(-MAX_SUBMISSIONS_PER_PAGE);

  await Promise.all([
    env.PAGE_KV.put(submissionKey, JSON.stringify(submission)),
    env.PAGE_KV.put(indexKey, JSON.stringify(trimmedIndex)),
  ]);
}

export async function submitContact(
  req: Request,
  env: any,
  pageId: string,
  headers: HeadersInit
): Promise<Response> {
  const canonicalPageId = await resolvePageId(env, pageId);
  if (!canonicalPageId) {
    return errorResponse("페이지를 찾을 수 없습니다", 404, headers);
  }

  const { schema, settings, accessControl } = await readContactSchema(env, canonicalPageId);
  if (!settings.enabled) {
    return errorResponse("컨택트 폼이 비활성화되었습니다", 404, headers);
  }

  if (!schema.length) {
    return errorResponse("컨택트 폼이 설정되지 않았습니다", 404, headers);
  }

  if (accessControl?.enabled) {
    const urlCode = new URL(req.url).searchParams.get("code");
    const headerCode = req.headers.get("X-Page-Code");
    const provided = headerCode || urlCode;
    if (!provided || provided !== accessControl.code) {
      return errorResponseWithCode("접근 코드가 필요합니다", "FORBIDDEN", 401, headers);
    }
  }

  let body: any;
  try {
    body = await req.json();
  } catch (error) {
    return errorResponse("잘못된 본문입니다", 400, headers);
  }

  const honeypot = typeof body?.company === "string" ? body.company.trim() : "";
  if (honeypot) {
    return jsonResponse({ ok: true, ignored: true }, 202, headers);
  }

  if (settings.consentRequired) {
    const consent = body?.consentChecked === true;
    if (!consent) {
      return errorResponse("개인정보 수집 동의가 필요합니다", 422, headers);
    }
  }

  const ip = req.headers.get("CF-Connecting-IP") || req.headers.get("x-forwarded-for");
  const userAgent = req.headers.get("user-agent");
  const turnstileOk = await verifyTurnstile(env, body?.turnstileToken, ip);
  if (!turnstileOk) {
    return errorResponse("봇 검증에 실패했습니다", 400, headers);
  }

  const answersInput = Array.isArray(body?.answers) ? body.answers : [];
  if (!answersInput.length) {
    return errorResponse("answers 배열이 필요합니다", 400, headers);
  }

  const errors: string[] = [];
  const answers = schema
    .map((field) => {
      const raw = answersInput.find((item) => item?.label === field.label);
      const value = sanitizeString(raw?.value, MAX_FIELD_LENGTH) || "";

      if (field.required && !value) {
        errors.push(`${field.label}을(를) 입력해주세요.`);
        return null;
      }

      if (!value) return null;

      if (field.type === "email" && value && !/^\S+@\S+\.\S+$/.test(value)) {
        errors.push(`${field.label}이 올바른 이메일 형식이 아닙니다.`);
        return null;
      }

      if (field.type === "tel" && value && value.replace(/[^0-9+\-]/g, "").length < 6) {
        errors.push(`${field.label}이 올바른 전화번호 형식인지 확인해주세요.`);
        return null;
      }

      if (field.type === "url" && value && !(value.startsWith("http://") || value.startsWith("https://"))) {
        errors.push(`${field.label}은 http(s) URL이어야 합니다.`);
        return null;
      }

      if ((field.type === "select" || field.type === "checkbox") && Array.isArray(field.options) && field.options.length) {
        const selections = value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        const invalid = selections.filter((item) => !field.options!.includes(item));
        if (invalid.length) {
          errors.push(`${field.label} 값이 허용된 옵션에 없습니다.`);
          return null;
        }
      }

      return {
        label: field.label,
        type: field.type,
        value,
      } as ContactSubmission["answers"][number];
    })
    .filter(Boolean) as ContactSubmission["answers"];

  if (errors.length) {
    return errorResponse(errors.join(" "), 422, headers);
  }

  if (!answers.length) {
    return errorResponse("제출할 답변이 없습니다", 400, headers);
  }

  const submission: ContactSubmission = {
    id: crypto.randomUUID(),
    pageId: canonicalPageId,
    submittedAt: new Date().toISOString(),
    answers,
    consentChecked: body?.consentChecked === true,
    ip,
    userAgent,
  };

  try {
    await checkSubmissionThrottle(env, canonicalPageId, submission.ip || null, submission.userAgent || null);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "제출 제한을 초과했습니다", 429, headers);
  }

  await storeSubmission(env, submission);
  forwardSubmission(env, submission, settings);

  return jsonResponse({ ok: true, id: submission.id }, 201, headers);
}

async function deleteSubmissionRecords(env: any, pageId: string, ids: string[]) {
  if (!ids.length) return 0;
  await Promise.all(ids.map((id) => env.PAGE_KV.delete(`contact:${pageId}:${id}`)));
  return ids.length;
}

export async function clearContactSubmissionsData(
  env: any,
  pageId: string,
  beforeDays?: number
) {
  const indexKey = `contact:${pageId}:index`;
  const indexRaw = await env.PAGE_KV.get(indexKey);
  let ids: string[] = [];
  if (indexRaw) {
    try {
      ids = JSON.parse(indexRaw);
    } catch (error) {
      ids = [];
    }
  }

  if (!ids.length) {
    return { removed: 0, remaining: 0 };
  }

  let toRemove = ids;
  let keep = [] as string[];
  if (beforeDays && Number.isFinite(beforeDays) && beforeDays > 0) {
    const threshold = Date.now() - beforeDays * 24 * 60 * 60 * 1000;
    const records = await Promise.all(ids.map((id) => env.PAGE_KV.get(`contact:${pageId}:${id}`)));
    ids.forEach((id, idx) => {
      const raw = records[idx];
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as ContactSubmission;
        const submittedAt = Date.parse(parsed.submittedAt);
        if (Number.isFinite(submittedAt) && submittedAt < threshold) {
          return;
        }
      } catch (error) {
        return;
      }
      keep.push(id);
    });
    toRemove = ids.filter((id) => !keep.includes(id));
  }

  if (beforeDays) {
    await env.PAGE_KV.put(indexKey, JSON.stringify(keep));
  } else {
    await env.PAGE_KV.delete(indexKey);
  }
  const removed = await deleteSubmissionRecords(env, pageId, toRemove);
  return { removed, remaining: keep.length };
}

export async function deleteContactSubmissions(
  req: Request,
  env: any,
  pageId: string,
  headers: HeadersInit
): Promise<Response> {
  const token = getBearerToken(req);
  const canonicalPageId = await resolvePageId(env, pageId);
  const pageTokenValid = await verifySessionToken(env, "page", token, canonicalPageId);
  const superTokenValid = await verifySessionToken(env, "super", token);

  if (!pageTokenValid && !superTokenValid) {
    return errorResponse("인증이 필요합니다", 401, headers);
  }

  const url = new URL(req.url);
  const beforeDays = Number(url.searchParams.get("beforeDays"));
  const effectiveBeforeDays = Number.isFinite(beforeDays) && beforeDays > 0 ? beforeDays : undefined;
  const { removed, remaining } = await clearContactSubmissionsData(
    env,
    canonicalPageId,
    effectiveBeforeDays
  );

  return jsonResponse(
    {
      success: true,
      deleted: removed,
      remaining,
      retentionDays: Number(env.CONTACT_RETENTION_DAYS) || DEFAULT_CONTACT_RETENTION_DAYS,
    },
    200,
    headers
  );
}

export async function countSubmissions(env: any, pageId: string): Promise<number> {
  const indexKey = `contact:${pageId}:index`;
  const indexRaw = await env.PAGE_KV.get(indexKey);
  if (!indexRaw) return 0;

  try {
    const parsed = JSON.parse(indexRaw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch (error) {
    return 0;
  }
}

export async function fetchSubmissions(env: any, pageId: string, limit = 50): Promise<ContactSubmission[]> {
  const indexKey = `contact:${pageId}:index`;
  const indexRaw = await env.PAGE_KV.get(indexKey);
  if (!indexRaw) return [];

  let ids: string[] = [];
  try {
    ids = JSON.parse(indexRaw);
  } catch (error) {
    ids = [];
  }

  const recentIds = ids.slice(-limit).reverse();
  const rows = await Promise.all(
    recentIds.map((id) => env.PAGE_KV.get(`contact:${pageId}:${id}`))
  );

  return rows
    .map((row) => {
      if (!row) return null;
      try {
        return JSON.parse(row) as ContactSubmission;
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean) as ContactSubmission[];
}

export async function listContactSubmissions(
  req: Request,
  env: any,
  pageId: string,
  headers: HeadersInit
): Promise<Response> {
  const token = getBearerToken(req);
  const canonicalPageId = await resolvePageId(env, pageId);
  const pageTokenValid = await verifySessionToken(env, "page", token, canonicalPageId);
  const superTokenValid = await verifySessionToken(env, "super", token);

  if (!pageTokenValid && !superTokenValid) {
    return errorResponse("인증이 필요합니다", 401, headers);
  }

  const submissions = await fetchSubmissions(env, canonicalPageId, 50);
  return jsonResponse({ submissions }, 200, headers);
}

export async function exportContactSubmissions(
  req: Request,
  env: any,
  pageId: string,
  headers: HeadersInit
): Promise<Response> {
  const token = getBearerToken(req);
  const canonicalPageId = await resolvePageId(env, pageId);
  const pageTokenValid = await verifySessionToken(env, "page", token, canonicalPageId);
  const superTokenValid = await verifySessionToken(env, "super", token);

  if (!pageTokenValid && !superTokenValid) {
    return errorResponse("인증이 필요합니다", 401, headers);
  }

  try {
    const planId = (await getPagePlanId(env, canonicalPageId)) ?? "free";
    await enforcePlanLimit(env, planId, "export_csv");
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return errorResponseWithCode(error.message, "PLAN_LIMIT_EXCEEDED", error.status, headers);
    }
    throw error;
  }

  const submissions = await fetchSubmissions(env, canonicalPageId, 200);
  const header = ["id", "pageId", "submittedAt", "ip", "userAgent", "answers"].join(",");
  const rows = submissions.map((s) => {
    const answers = s.answers.map((a) => `${a.label}:${a.value}`).join(" | ");
    return [s.id, s.pageId, s.submittedAt, s.ip ?? "", s.userAgent ?? "", answers]
      .map((value) => `"${(value ?? "").toString().replace(/"/g, '""')}"`)
      .join(",");
  });

  const csv = [header, ...rows].join("\n");
  return new Response(csv, {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contact-submissions-${canonicalPageId}.csv"`,
    },
  });
}
