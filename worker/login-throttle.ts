const DEFAULT_WINDOW_SECONDS = 15 * 60; // 15 minutes
const DEFAULT_MAX_ATTEMPTS = 5;

type AttemptState = {
  count: number;
  resetAt: number;
};

function normalizeIdentifier(identifier: string) {
  return identifier.trim().toLowerCase();
}

export function buildLoginIdentifier(req: Request, subject: string) {
  const ip =
    req.headers.get("CF-Connecting-IP")?.trim() ||
    req.headers
      .get("X-Forwarded-For")
      ?.split(",")[0]
      ?.trim() ||
    "unknown";

  const normalizedSubject = normalizeIdentifier(subject || "anonymous");
  return `${normalizedSubject}@${ip}`;
}

async function getState(env: any, scope: string, identifier: string) {
  if (!env?.PAGE_KV) return null;
  const key = `login:${scope}:${identifier}`;
  const raw = await env.PAGE_KV.get(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as AttemptState;
    if (typeof parsed.resetAt === "number" && typeof parsed.count === "number") {
      return parsed;
    }
  } catch (error) {
    return null;
  }

  return null;
}

async function persistState(
  env: any,
  scope: string,
  identifier: string,
  state: AttemptState
) {
  if (!env?.PAGE_KV) return;
  const now = Date.now();
  const ttlSeconds = Math.max(30, Math.ceil((state.resetAt - now) / 1000));
  await env.PAGE_KV.put(`login:${scope}:${identifier}`, JSON.stringify(state), {
    expirationTtl: ttlSeconds,
  });
}

export async function getLoginThrottle(
  env: any,
  scope: string,
  identifier: string,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  windowSeconds = DEFAULT_WINDOW_SECONDS
) {
  const now = Date.now();
  const state = (await getState(env, scope, identifier)) || {
    count: 0,
    resetAt: now + windowSeconds * 1000,
  };

  if (state.resetAt <= now) {
    return {
      blocked: false,
      remaining: maxAttempts,
      resetAt: now + windowSeconds * 1000,
    };
  }

  const blocked = state.count >= maxAttempts;
  const remaining = Math.max(0, maxAttempts - state.count);

  return { blocked, remaining, resetAt: state.resetAt };
}

export async function recordFailedLogin(
  env: any,
  scope: string,
  identifier: string,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  windowSeconds = DEFAULT_WINDOW_SECONDS
) {
  if (!env?.PAGE_KV) {
    return { blocked: false, remaining: maxAttempts, resetAt: Date.now() + windowSeconds * 1000 };
  }
  const now = Date.now();
  const current = (await getState(env, scope, identifier)) || {
    count: 0,
    resetAt: now + windowSeconds * 1000,
  };

  const nextWindow = current.resetAt <= now;
  const nextState: AttemptState = {
    count: nextWindow ? 1 : current.count + 1,
    resetAt: nextWindow ? now + windowSeconds * 1000 : current.resetAt,
  };

  await persistState(env, scope, identifier, nextState);

  const blocked = nextState.count >= maxAttempts;
  const remaining = Math.max(0, maxAttempts - nextState.count);

  return { blocked, remaining, resetAt: nextState.resetAt };
}

export async function clearLoginAttempts(env: any, scope: string, identifier: string) {
  if (!env?.PAGE_KV) return;
  await env.PAGE_KV.delete(`login:${scope}:${identifier}`);
}
