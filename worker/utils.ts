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
