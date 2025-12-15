export type SessionRole = "super" | "page";

export async function createSessionToken(
  env: any,
  role: SessionRole,
  subject: string,
  ttlSeconds = 3600
): Promise<{ token: string; expiresIn: number }> {
  const token = crypto.randomUUID();
  const record = { role, subject, createdAt: new Date().toISOString() };

  await env.PAGE_KV.put(`session:${role}:${token}`, JSON.stringify(record), {
    expirationTtl: ttlSeconds,
  });

  return { token, expiresIn: ttlSeconds };
}

export async function verifySessionToken(
  env: any,
  role: SessionRole,
  token: string | null,
  expectedSubject?: string
): Promise<boolean> {
  if (!token) return false;

  const record = await env.PAGE_KV.get(`session:${role}:${token}`);
  if (!record) return false;

  if (!expectedSubject) return true;

  try {
    const parsed = JSON.parse(record);
    return parsed.subject === expectedSubject;
  } catch (error) {
    return false;
  }
}

export function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}
