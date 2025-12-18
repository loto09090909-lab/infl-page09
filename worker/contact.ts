import { getBearerToken, verifySessionToken } from "./auth";
import { resolvePageId } from "./slug";
import { errorResponse, jsonResponse } from "./utils";

type ContactField = {
  label: string;
  type: string;
  placeholder?: string;
};

type ContactSubmission = {
  id: string;
  pageId: string;
  submittedAt: string;
  answers: { label: string; type: string; value: string }[];
  ip?: string | null;
  userAgent?: string | null;
};

const MAX_FIELD_LENGTH = 2000;
const MAX_SUBMISSIONS_PER_PAGE = 200;

function sanitizeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

async function readContactSchema(env: any, pageId: string): Promise<ContactField[]> {
  const kvRaw = await env.PAGE_KV.get(`page:${pageId}`);
  if (!kvRaw) return [];
  try {
    const parsed = JSON.parse(kvRaw);
    if (Array.isArray(parsed?.contactSchema)) {
      return parsed.contactSchema.filter((field: any) => field && typeof field === "object");
    }
    return [];
  } catch (error) {
    return [];
  }
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

  const schema = await readContactSchema(env, canonicalPageId);
  if (!schema.length) {
    return errorResponse("컨택트 폼이 설정되지 않았습니다", 404, headers);
  }

  let body: any;
  try {
    body = await req.json();
  } catch (error) {
    return errorResponse("잘못된 본문입니다", 400, headers);
  }

  const answersInput = Array.isArray(body?.answers) ? body.answers : [];
  if (!answersInput.length) {
    return errorResponse("answers 배열이 필요합니다", 400, headers);
  }

  const answers = schema
    .map((field) => {
      const raw = answersInput.find((item) => item?.label === field.label);
      const value = sanitizeString(raw?.value, MAX_FIELD_LENGTH);
      return value
        ? {
            label: field.label,
            type: field.type,
            value,
          }
        : null;
    })
    .filter(Boolean) as ContactSubmission["answers"];

  if (!answers.length) {
    return errorResponse("제출할 답변이 없습니다", 400, headers);
  }

  const submission: ContactSubmission = {
    id: crypto.randomUUID(),
    pageId: canonicalPageId,
    submittedAt: new Date().toISOString(),
    answers,
    ip: req.headers.get("CF-Connecting-IP") || req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  };

  await storeSubmission(env, submission);

  return jsonResponse({ ok: true, id: submission.id }, 201, headers);
}

async function fetchSubmissions(env: any, pageId: string, limit = 50): Promise<ContactSubmission[]> {
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
