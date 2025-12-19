import { createSessionToken } from "./auth";
import { errorResponse, jsonResponse, parseJsonBody } from "./utils";

export type UserRow = {
  id: string;
  email: string;
  password_hash: string | null;
  oauth_provider: string | null;
  oauth_id: string | null;
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

export async function verifyPassword(password: string, stored: string | null) {
  if (!stored) return false;
  if (stored.startsWith(`${PBKDF2_PREFIX}$`)) {
    return verifyPbkdf2(password, stored);
  }

  if (isLegacySha256(stored)) {
    return verifyLegacySha256(password, stored);
  }

  return false;
}

async function getUserByEmail(env: any, email: string) {
  return env.DB.prepare(
    "SELECT id, email, password_hash, oauth_provider, oauth_id, failed_attempts, locked_until FROM users WHERE email = ? LIMIT 1"
  )
    .bind(email)
    .first<UserRow>();
}

export async function getUserById(env: any, id: string) {
  return env.DB.prepare(
    "SELECT id, email, password_hash, oauth_provider, oauth_id, failed_attempts, locked_until FROM users WHERE id = ? LIMIT 1"
  )
    .bind(id)
    .first<UserRow>();
}

async function createUser(env: any, data: AuthBody): Promise<UserRow> {
  const userId = crypto.randomUUID();
  const passwordHash = data.password ? await hashPassword(data.password) : null;
  await env.DB.prepare(
    "INSERT INTO users (id, email, password_hash, oauth_provider, oauth_id) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(
      userId,
      data.email!,
      passwordHash,
      data.oauthProvider ?? null,
      data.oauthId ?? null
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
  const session = await createSessionToken(env, "user", created.id);
  return jsonResponse(session, 201, headers);
}

export async function login(req: Request, env: any, headers: HeadersInit) {
  const body = await parseJsonBody<AuthBody>(req);
  if (!body || typeof body.email !== "string") {
    return errorResponse("이메일을 입력하세요", 400, headers);
  }

  const email = body.email.trim().toLowerCase();
  const user = await getUserByEmail(env, email);
  if (!user) {
    return errorResponse("계정을 찾을 수 없습니다", 404, headers);
  }

  if (isLocked(user)) {
    return errorResponse("로그인 시도가 일시적으로 제한되었습니다", 423, headers);
  }

  const authResult = await authenticateUser(user, body);
  if (!authResult) {
    await recordFailure(env, user.id);
    return errorResponse("인증에 실패했습니다", 401, headers);
  }

  await clearFailures(env, user.id);
  const session = await createSessionToken(env, "user", user.id);
  return jsonResponse(session, 200, headers);
}

export async function findOrCreateUser(env: any, data: AuthBody) {
  const email = (data.email || "").trim().toLowerCase();
  if (!email) {
    throw new Error("이메일이 필요합니다");
  }

  const existing = await getUserByEmail(env, email);
  if (existing) {
    return existing;
  }

  return createUser(env, { ...data, email });
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
  if (!user) {
    return { error: "계정을 찾을 수 없습니다", status: 404 } as const;
  }

  if (isLocked(user)) {
    return { error: "로그인 시도가 일시적으로 제한되었습니다", status: 423 } as const;
  }

  const authenticated = await authenticateUser(user, credentials);
  if (!authenticated) {
    await recordFailure(env, user.id);
    return { error: "인증에 실패했습니다", status: 401 } as const;
  }

  await clearFailures(env, user.id);
  return { user } as const;
}

async function authenticateUser(user: UserRow, credentials: AuthBody) {
  const isOAuth = !!(credentials.oauthProvider && credentials.oauthId);

  if (isOAuth) {
    return (
      user.oauth_provider === credentials.oauthProvider &&
      user.oauth_id === credentials.oauthId &&
      !!user.oauth_provider
    );
  }

  if (!credentials.password || !user.password_hash) {
    return false;
  }

  return verifyPassword(credentials.password, user.password_hash);
}
