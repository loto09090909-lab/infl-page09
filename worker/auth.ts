export type SessionRole = "super" | "page" | "user";

type SignedPayload = {
  role: SessionRole;
  sub: string;
  iat: number;
  exp: number;
  jti: string;
};

const encoder = new TextEncoder();

function base64UrlEncode(data: Uint8Array) {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getHmacKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signToken(secret: string, payload: SignedPayload) {
  const header = { alg: "HS256", typ: "JWT" };
  const headerPart = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadPart = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const key = await getHmacKey(secret);
  const data = `${headerPart}.${payloadPart}`;
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  const signaturePart = base64UrlEncode(new Uint8Array(signature));
  return `${data}.${signaturePart}`;
}

async function parseAndVerifyToken(secret: string, token: string): Promise<SignedPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerPart, payloadPart, signaturePart] = parts;
  const data = `${headerPart}.${payloadPart}`;
  const key = await getHmacKey(secret);

  try {
    const valid = await crypto.subtle.verify("HMAC", key, base64UrlDecode(signaturePart), encoder.encode(data));
    if (!valid) return null;

    const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadPart));
    const payload = JSON.parse(payloadJson) as SignedPayload;
    if (!payload || !payload.role || !payload.sub || !payload.exp || !payload.jti) return null;
    return payload;
  } catch (error) {
    return null;
  }
}

export async function getSessionSubject(
  env: any,
  role: SessionRole,
  token: string | null
): Promise<string | null> {
  if (!token) return null;

  const secret = getSessionSecret(env);
  if (secret) {
    const payload = await parseAndVerifyToken(secret, token);
    if (!payload) return null;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) return null;
    if (payload.role !== role) return null;
    if (await isRevoked(env, payload.jti)) return null;
    return payload.sub;
  }

  const record = await env.PAGE_KV.get(`session:${role}:${token}`);
  if (!record) return null;
  try {
    const parsed = JSON.parse(record);
    if (!parsed?.subject) return null;
    if (parsed.exp && typeof parsed.exp === "number") {
      const now = Math.floor(Date.now() / 1000);
      if (parsed.exp <= now) return null;
    }
    return parsed.subject;
  } catch (error) {
    return null;
  }
}

function getSessionSecret(env: any): string | null {
  return env.TOKEN_SECRET || env.SESSION_SECRET || null;
}

function requireSessionSecret(env: any): string {
  const secret = getSessionSecret(env);
  if (!secret) {
    throw new Error("TOKEN_SECRET 또는 SESSION_SECRET이 필요합니다.");
  }
  return secret;
}

async function verifyLegacySession(
  env: any,
  role: SessionRole,
  token: string,
  expectedSubject?: string
): Promise<boolean> {
  const record = await env.PAGE_KV.get(`session:${role}:${token}`);
  if (!record) return false;

  if (!expectedSubject) return true;

  try {
    const parsed = JSON.parse(record);
    if (parsed.subject !== expectedSubject) return false;
    if (parsed.exp && typeof parsed.exp === "number") {
      const now = Math.floor(Date.now() / 1000);
      if (parsed.exp <= now) return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

async function isRevoked(env: any, jti: string) {
  return Boolean(await env.PAGE_KV.get(`revoked:${jti}`));
}

export async function createSessionToken(
  env: any,
  role: SessionRole,
  subject: string,
  ttlSeconds = 3600
): Promise<{ token: string; expiresIn: number }> {
  const secret = requireSessionSecret(env);
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;

  const payload: SignedPayload = {
    role,
    sub: subject,
    iat: now,
    exp,
    jti: crypto.randomUUID(),
  };

  const token = await signToken(secret, payload);
  return { token, expiresIn: ttlSeconds };
}

export async function verifySessionToken(
  env: any,
  role: SessionRole,
  token: string | null,
  expectedSubject?: string
): Promise<boolean> {
  if (!token) return false;

  const secret = getSessionSecret(env);
  if (secret) {
    const payload = await parseAndVerifyToken(secret, token);
    if (payload) {
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp <= now) return false;
      if (payload.role !== role) return false;
      if (expectedSubject && payload.sub !== expectedSubject) return false;
      if (await isRevoked(env, payload.jti)) return false;
      return true;
    }
  }

  return verifyLegacySession(env, role, token, expectedSubject);
}

export async function revokeSessionToken(env: any, role: SessionRole, token: string | null) {
  if (!token) return;
  const secret = getSessionSecret(env);
  if (secret) {
    const payload = await parseAndVerifyToken(secret, token);
    if (payload) {
      await env.PAGE_KV.put(`revoked:${payload.jti}`, "1", { expiration: payload.exp });
      return;
    }
  }

  await env.PAGE_KV.delete(`session:${role}:${token}`);
}

export function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}
