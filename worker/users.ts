import { createSessionToken, hasSessionSecret } from "./auth";
import { enforcePlanLimit, PlanLimitError } from "./plan-limits";
import { normalizeSlugs, replaceSlugMap, findConflictingSlug } from "./slug-map";
import { slugify } from "./slug";
import { errorResponse, errorResponseWithCode, jsonResponse, parseJsonBody } from "./utils";

export type UserRow = {
  id: string;
  email: string;
  password_hash: string | null;
  oauth_provider: string | null;
  oauth_id: string | null;
  plan_id?: string | null;
  failed_attempts: number;
  locked_until: number | null;
};

export type AuthBody = {
  email?: string;
  password?: string;
  oauthProvider?: string;
  oauthId?: string;
};

const MAX_ATTEMPTS = 5;
const LOCK_MILLISECONDS = 15 * 60 * 1000;

const PBKDF2_ITERATIONS = 70_000;
const PBKDF2_KEY_LENGTH = 32; // bytes
const PBKDF2_PREFIX = "pbkdf2";
const DEFAULT_PLAN = "free";
const MAX_PAGE_ID_ATTEMPTS = 6;
const LEGACY_HASH_ENV_KEY = "ALLOW_LEGACY_SHA256";

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function pageExists(env: any, pageId: string) {
  const kv = await env.PAGE_KV.get(`page:${pageId}`);
  if (kv) return true;
  const row = await env.DB.prepare(
    "SELECT page_id FROM page_meta WHERE page_id = ? LIMIT 1"
  )
    .bind(pageId)
    .first<{ page_id: string }>();
  return !!row;
}

function buildBasePageId(email: string) {
  const localPart = email.split("@")[0] || "page";
  return slugify(localPart) || "page";
}

async function generateUniquePageId(env: any, email: string) {
  const base = buildBasePageId(email);
  for (let i = 0; i < MAX_PAGE_ID_ATTEMPTS; i += 1) {
    const suffix = i === 0 ? "" : `-${Math.floor(Math.random() * 10000)}`;
    const candidate = `${base}${suffix}`;
    if (!(await pageExists(env, candidate))) {
      return candidate;
    }
  }
  return `page-${crypto.randomUUID().slice(0, 8)}`;
}

async function provisionDefaultPage(env: any, userId: string, email: string) {
  await enforcePlanLimit(env, DEFAULT_PLAN, "create_page");
  const pageId = await generateUniquePageId(env, email);
  const slugs = normalizeSlugs([], pageId);
  const conflict = await findConflictingSlug(env, slugs, pageId);
  if (conflict) {
    throw new Error(`이미 다른 페이지에 사용 중인 슬러그입니다: ${conflict}`);
  }

  const profile = { name: email.split("@")[0] || "User" };
  const pageData = {
    profile,
    links: [],
    privateLinks: [],
    contactSchema: [],
    contactSettings: { enabled: false },
    accessControl: { enabled: false },
    slugs,
    plan: DEFAULT_PLAN,
    theme: "classic",
  };

  await env.PAGE_KV.put(`page:${pageId}`, JSON.stringify(pageData));

  await env.DB.prepare(
    "INSERT OR REPLACE INTO page_meta (page_id, name, photo_url, description, links, plan_id) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(pageId, profile.name ?? null, null, null, JSON.stringify([]), DEFAULT_PLAN)
    .run();

  await env.DB.prepare("INSERT OR IGNORE INTO page_admins (page_id, user_id) VALUES (?, ?)")
    .bind(pageId, userId)
    .run();

  await env.DB.prepare(
    "INSERT OR IGNORE INTO page_members (page_id, user_id, role) VALUES (?, ?, 'owner')"
  )
    .bind(pageId, userId)
    .run();

  await replaceSlugMap(env, pageId, slugs);

  return pageId;
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encodedPassword = new TextEncoder().encode(password);
  const key = await crypto.subtle.importKey("raw", encodedPassword, "PBKDF2", false, ["deriveBits"]);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    key,
    PBKDF2_KEY_LENGTH * 8
  );

  const saltB64 = bufferToBase64(salt.buffer);
  const hashB64 = bufferToBase64(derivedBits);

  return `${PBKDF2_PREFIX}$${PBKDF2_ITERATIONS}$${saltB64}$${hashB64}`;
}

function isLegacySha256(hash: string) {
  return /^[a-f0-9]{64}$/i.test(hash);
}

function allowLegacySha256(env: any) {
  const raw = env?.[LEGACY_HASH_ENV_KEY];
  if (raw === undefined || raw === null) {
    return true;
  }
  return String(raw).toLowerCase() !== "false";
}

async function verifyPbkdf2(password: string, stored: string) {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== PBKDF2_PREFIX) return false;

  const iterations = Number(parts[1]);
  const salt = base64ToBuffer(parts[2]);
  const expected = parts[3];

  if (!Number.isFinite(iterations) || iterations <= 0) return false;

  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    key,
    PBKDF2_KEY_LENGTH * 8
  );

  const actual = bufferToBase64(derivedBits);
  return actual === expected;
}

async function verifyLegacySha256(password: string, stored: string) {
  const encoded = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === stored;
}

export async function verifyPasswordWithUpgrade(
  env: any,
  password: string,
  stored: string | null
) {
  if (!stored) return { valid: false } as const;
  if (stored.startsWith(`${PBKDF2_PREFIX}$`)) {
    const valid = await verifyPbkdf2(password, stored);
    return valid ? ({ valid: true } as const) : ({ valid: false } as const);
  }

  if (isLegacySha256(stored)) {
    if (!allowLegacySha256(env)) {
      return { valid: false } as const;
    }
    const valid = await verifyLegacySha256(password, stored);
    if (!valid) {
      return { valid: false } as const;
    }
    const upgradedHash = await hashPassword(password);
    return { valid: true, upgradedHash } as const;
  }

  return { valid: false } as const;
}

async function getUserByEmail(env: any, email: string) {
  return env.DB.prepare(
    "SELECT id, email, password_hash, oauth_provider, oauth_id, plan_id, failed_attempts, locked_until FROM users WHERE email = ? LIMIT 1"
  )
    .bind(email)
    .first<UserRow>();
}

export async function getUserById(env: any, id: string) {
  return env.DB.prepare(
    "SELECT id, email, password_hash, oauth_provider, oauth_id, plan_id, failed_attempts, locked_until FROM users WHERE id = ? LIMIT 1"
  )
    .bind(id)
    .first<UserRow>();
}

async function ensureUserPlan(env: any, user: UserRow | null) {
  if (!user) return null;
  if (user.plan_id) return user;

  await env.DB.prepare("UPDATE users SET plan_id = ? WHERE id = ?")
    .bind(DEFAULT_PLAN, user.id)
    .run();
  return { ...user, plan_id: DEFAULT_PLAN };
}

async function createUser(env: any, data: AuthBody): Promise<UserRow> {
  const userId = crypto.randomUUID();
  const passwordHash = data.password ? await hashPassword(data.password) : null;
  await env.DB.prepare(
    "INSERT INTO users (id, email, password_hash, oauth_provider, oauth_id, plan_id) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(
      userId,
      data.email!,
      passwordHash,
      data.oauthProvider ?? null,
      data.oauthId ?? null,
      DEFAULT_PLAN
    )
    .run();

  return {
    id: userId,
    email: data.email!,
    password_hash: passwordHash,
    oauth_provider: data.oauthProvider ?? null,
    oauth_id: data.oauthId ?? null,
    failed_attempts: 0,
    locked_until: null,
  };
}

async function recordFailure(env: any, userId: string) {
  const lockUntil = Date.now() + LOCK_MILLISECONDS;
  await env.DB.prepare(
    "UPDATE users SET failed_attempts = failed_attempts + 1, locked_until = CASE WHEN failed_attempts + 1 >= ? THEN ? ELSE locked_until END WHERE id = ?"
  )
    .bind(MAX_ATTEMPTS, lockUntil, userId)
    .run();
}

async function clearFailures(env: any, userId: string) {
  await env.DB.prepare(
    "UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?"
  )
    .bind(userId)
    .run();
}

function isLocked(user: UserRow) {
  if (!user.locked_until) return false;
  return Date.now() < user.locked_until;
}

export async function signup(req: Request, env: any, headers: HeadersInit) {
  if (!hasSessionSecret(env)) {
    return errorResponse("TOKEN_SECRET 또는 SESSION_SECRET이 필요합니다.", 500, headers);
  }

  const body = await parseJsonBody<AuthBody>(req);
  if (!body || typeof body.email !== "string") {
    return errorResponse("이메일을 입력하세요", 400, headers);
  }

  const email = body.email.trim().toLowerCase();
  const isOAuth = !!(body.oauthProvider && body.oauthId);

  if (!isOAuth && typeof body.password !== "string") {
    return errorResponse("비밀번호를 입력하세요", 400, headers);
  }

  const existing = await getUserByEmail(env, email);
  if (existing) {
    return errorResponse("이미 가입된 이메일입니다", 409, headers);
  }

  const created = await createUser(env, { ...body, email });
  let pageId: string | null = null;
  try {
    pageId = await provisionDefaultPage(env, created.id, email);
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return errorResponseWithCode(error.message, "PLAN_LIMIT_EXCEEDED", error.status, headers);
    }
    throw error;
  }
  const session = await createSessionToken(env, "user", created.id);
  return jsonResponse({ ...session, pageId }, 201, headers);
}

export async function login(req: Request, env: any, headers: HeadersInit) {
  if (!hasSessionSecret(env)) {
    return errorResponse("TOKEN_SECRET 또는 SESSION_SECRET이 필요합니다.", 500, headers);
  }

  const body = await parseJsonBody<AuthBody>(req);
  if (!body || typeof body.email !== "string") {
    return errorResponse("이메일을 입력하세요", 400, headers);
  }

  const email = body.email.trim().toLowerCase();
  const user = await getUserByEmail(env, email);
  const normalized = await ensureUserPlan(env, user);
  if (!normalized) {
    return errorResponse("계정을 찾을 수 없습니다", 404, headers);
  }

  if (isLocked(normalized)) {
    return errorResponse("로그인 시도가 일시적으로 제한되었습니다", 423, headers);
  }

  const authResult = await authenticateUser(env, normalized, body);
  if (!authResult.authenticated) {
    await recordFailure(env, normalized.id);
    return errorResponse("인증에 실패했습니다", 401, headers);
  }

  await clearFailures(env, normalized.id);
  if (authResult.upgradedHash) {
    await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .bind(authResult.upgradedHash, normalized.id)
      .run();
  }
  const session = await createSessionToken(env, "user", normalized.id);
  return jsonResponse(session, 200, headers);
}

export async function findOrCreateUser(env: any, data: AuthBody) {
  const email = (data.email || "").trim().toLowerCase();
  if (!email) {
    throw new Error("이메일이 필요합니다");
  }

  const existing = await getUserByEmail(env, email);
  const normalized = await ensureUserPlan(env, existing);
  if (normalized) {
    return normalized;
  }

  return createUser(env, { ...data, email });
}

export async function findOrCreateOAuthUser(
  env: any,
  data: { email: string; oauthProvider: string; oauthId: string }
) {
  const email = data.email.trim().toLowerCase();
  const existing = await getUserByEmail(env, email);

  if (existing) {
    if (
      existing.oauth_provider &&
      existing.oauth_id &&
      (existing.oauth_provider !== data.oauthProvider || existing.oauth_id !== data.oauthId)
    ) {
      throw new Error("이미 다른 OAuth 계정으로 연결된 이메일입니다");
    }

    if (!existing.oauth_provider || !existing.oauth_id) {
      await env.DB.prepare(
        "UPDATE users SET oauth_provider = ?, oauth_id = ? WHERE id = ?"
      )
        .bind(data.oauthProvider, data.oauthId, existing.id)
        .run();
      return { ...existing, oauth_provider: data.oauthProvider, oauth_id: data.oauthId };
    }

    return existing;
  }

  const created = await createUser(env, {
    email,
    oauthProvider: data.oauthProvider,
    oauthId: data.oauthId,
  });
  return created;
}

export async function updateUserPassword(env: any, userId: string, password: string) {
  const passwordHash = await hashPassword(password);
  await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
    .bind(passwordHash, userId)
    .run();
}

export async function authenticateExistingUser(env: any, credentials: AuthBody) {
  const email = (credentials.email || "").trim().toLowerCase();
  if (!email) {
    return { error: "이메일이 필요합니다", status: 400 } as const;
  }

  const user = await getUserByEmail(env, email);
  const normalized = await ensureUserPlan(env, user);
  if (!normalized) {
    return { error: "계정을 찾을 수 없습니다", status: 404 } as const;
  }

  if (isLocked(normalized)) {
    return { error: "로그인 시도가 일시적으로 제한되었습니다", status: 423 } as const;
  }

  const authResult = await authenticateUser(env, normalized, credentials);
  if (!authResult.authenticated) {
    await recordFailure(env, normalized.id);
    return { error: "인증에 실패했습니다", status: 401 } as const;
  }

  await clearFailures(env, normalized.id);
  if (authResult.upgradedHash) {
    await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .bind(authResult.upgradedHash, normalized.id)
      .run();
  }
  return { user: normalized } as const;
}

export async function deleteUserById(env: any, headers: HeadersInit, userId: string) {
  if (!userId) {
    return errorResponse("userId가 필요합니다", 400, headers);
  }

  const row = await env.DB.prepare("SELECT id FROM users WHERE id = ? LIMIT 1")
    .bind(userId)
    .first<{ id: string }>();

  if (!row) {
    return errorResponse("계정을 찾을 수 없습니다", 404, headers);
  }

  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
  return jsonResponse({ success: true, id: userId }, 200, headers);
}

async function authenticateUser(env: any, user: UserRow, credentials: AuthBody) {
  const isOAuth = !!(credentials.oauthProvider && credentials.oauthId);

  if (isOAuth) {
    return {
      authenticated:
        user.oauth_provider === credentials.oauthProvider &&
        user.oauth_id === credentials.oauthId &&
        !!user.oauth_provider,
    };
  }

  if (!credentials.password || !user.password_hash) {
    return { authenticated: false } as const;
  }

  const { valid, upgradedHash } = await verifyPasswordWithUpgrade(
    env,
    credentials.password,
    user.password_hash
  );
  return { authenticated: valid, upgradedHash } as const;
}
