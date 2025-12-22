export type CorsOptions = {
  allowedOrigins: string[];
};

export function resolveCorsOrigin(options: CorsOptions, requestOrigin: string | null): string {
  const { allowedOrigins } = options;
  if (allowedOrigins.includes("*")) {
    return "*";
  }

  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  return allowedOrigins[0] ?? "*";
}

export function buildCorsHeaders(options: CorsOptions, requestOrigin: string | null): HeadersInit {
  const origin = resolveCorsOrigin(options, requestOrigin);
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export function jsonResponse(data: any, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

export function errorResponse(message: string, status = 400, headers: HeadersInit = {}): Response {
  return jsonResponse({ error: message }, status, headers);
}

export function errorResponseWithCode(
  message: string,
  code: string,
  status = 400,
  headers: HeadersInit = {}
): Response {
  return jsonResponse({ error: message, code }, status, headers);
}

export async function parseJsonBody<T>(req: Request): Promise<T | null> {
  try {
    return await req.json<T>();
  } catch (error) {
    return null;
  }
}

export async function parseJsonBodyWithLimit<T>(
  req: Request,
  maxBytes: number
): Promise<{ data: T | null; error?: string }> {
  const text = await req.text();
  if (maxBytes > 0 && text.length > maxBytes) {
    return { data: null, error: "요청 본문이 너무 큽니다" };
  }

  if (!text.trim()) {
    return { data: null };
  }

  try {
    return { data: JSON.parse(text) as T };
  } catch (error) {
    return { data: null };
  }
}

export function validatePageId(value: unknown): { pageId?: string; error?: string } {
  if (typeof value !== "string") {
    return { error: "pageId는 문자열이어야 합니다" };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { error: "pageId가 필요합니다" };
  }
  if (trimmed.length > 64) {
    return { error: "pageId는 64자 이내여야 합니다" };
  }
  if (!/^[a-z0-9-]+$/i.test(trimmed)) {
    return { error: "pageId는 영문/숫자/하이픈만 사용할 수 있습니다" };
  }
  return { pageId: trimmed };
}

export function validateEmail(value: unknown): { email?: string; error?: string } {
  if (typeof value !== "string") {
    return { error: "이메일을 입력하세요" };
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return { error: "이메일을 입력하세요" };
  }
  if (trimmed.length > 254) {
    return { error: "이메일이 너무 깁니다" };
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    return { error: "이메일 형식이 올바르지 않습니다" };
  }
  return { email: trimmed };
}
