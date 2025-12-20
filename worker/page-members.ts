import { errorResponse, errorResponseWithCode, jsonResponse, parseJsonBody } from "./utils";
import { recordAuditEvent } from "./audit";

type Role = "owner" | "editor" | "viewer";

type InviteBody = {
  email?: string;
  role?: Role;
  expiresAt?: string;
};

function sanitizeString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function normalizeRole(value: unknown): Role | null {
  if (value === "owner" || value === "editor" || value === "viewer") {
    return value;
  }
  return null;
}

async function getUserEmail(env: any, userId: string) {
  const row = await env.DB.prepare("SELECT email FROM users WHERE id = ? LIMIT 1")
    .bind(userId)
    .first<{ email: string }>();
  return row?.email ?? null;
}

export async function getMemberRole(env: any, pageId: string, userId: string) {
  const row = await env.DB.prepare(
    "SELECT role FROM page_members WHERE page_id = ? AND user_id = ? LIMIT 1"
  )
    .bind(pageId, userId)
    .first<{ role: Role }>();
  if (row?.role) return row.role;
  const legacy = await env.DB.prepare(
    "SELECT 1 FROM page_admins WHERE page_id = ? AND user_id = ? LIMIT 1"
  )
    .bind(pageId, userId)
    .first<{ "1": number }>();
  return legacy ? "owner" : null;
}

export async function ensurePageMemberBridge(env: any, pageId: string, userId: string) {
  const existing = await env.DB.prepare(
    "SELECT 1 FROM page_members WHERE page_id = ? AND user_id = ? LIMIT 1"
  )
    .bind(pageId, userId)
    .first<{ "1": number }>();
  if (existing) return;

  const legacy = await env.DB.prepare(
    "SELECT 1 FROM page_admins WHERE page_id = ? AND user_id = ? LIMIT 1"
  )
    .bind(pageId, userId)
    .first<{ "1": number }>();
  if (legacy) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO page_members (page_id, user_id, role) VALUES (?, ?, 'owner')"
    )
      .bind(pageId, userId)
      .run();
  }
}

function canManageMembers(role: Role | null) {
  return role === "owner";
}

function canInvite(role: Role | null) {
  return role === "owner";
}

export async function listMembers(
  env: any,
  pageId: string,
  actorUserId: string
) {
  const role = await getMemberRole(env, pageId, actorUserId);
  if (role !== "owner") {
    return { error: "멤버 조회 권한이 없습니다", status: 403 } as const;
  }
  const rows = await env.DB.prepare(
    "SELECT user_id, role, created_at FROM page_members WHERE page_id = ? ORDER BY created_at ASC"
  )
    .bind(pageId)
    .all<{ user_id: string; role: Role; created_at: string }>();

  if (rows?.results?.length) {
    return { items: rows?.results ?? [] } as const;
  }

  const legacy = await env.DB.prepare(
    "SELECT user_id, created_at FROM page_admins WHERE page_id = ? ORDER BY created_at ASC"
  )
    .bind(pageId)
    .all<{ user_id: string; created_at: string }>();

  const items = (legacy?.results ?? []).map((row) => ({
    user_id: row.user_id,
    role: "owner" as const,
    created_at: row.created_at,
  }));

  return { items } as const;
}

export async function createInvite(
  req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string,
  actorUserId: string
) {
  const role = await getMemberRole(env, pageId, actorUserId);
  if (!canInvite(role)) {
    return errorResponseWithCode("초대 권한이 없습니다", "FORBIDDEN", 403, headers);
  }

  const body = await parseJsonBody<InviteBody>(req);
  const email = sanitizeString(body?.email, 200);
  const inviteRole = normalizeRole(body?.role) ?? "viewer";
  const expiresAt = sanitizeString(body?.expiresAt, 40);

  if (!email) {
    return errorResponse("이메일이 필요합니다", 400, headers);
  }

  const token = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT OR REPLACE INTO page_invites (token, page_id, email, role, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(token, pageId, email.toLowerCase(), inviteRole, actorUserId, expiresAt ?? null)
    .run();

  await recordAuditEvent(env, {
    pageId,
    actorUserId,
    action: "invite.created",
    metadata: { email, role: inviteRole },
  });

  return jsonResponse({ token, pageId, email, role: inviteRole, expiresAt }, 201, headers);
}

export async function listInvites(
  env: any,
  pageId: string,
  actorUserId: string
) {
  const role = await getMemberRole(env, pageId, actorUserId);
  if (role !== "owner") {
    return { error: "초대 조회 권한이 없습니다", status: 403 } as const;
  }

  const rows = await env.DB.prepare(
    "SELECT token, email, role, expires_at, created_at, created_by FROM page_invites WHERE page_id = ? ORDER BY created_at DESC"
  )
    .bind(pageId)
    .all<{
      token: string;
      email: string;
      role: Role;
      expires_at: string | null;
      created_at: string;
      created_by: string;
    }>();

  return { items: rows?.results ?? [] } as const;
}

export async function revokeInvite(
  env: any,
  pageId: string,
  token: string,
  actorUserId: string
) {
  const role = await getMemberRole(env, pageId, actorUserId);
  if (!canInvite(role)) {
    return { error: "초대 권한이 없습니다", status: 403 } as const;
  }

  await env.DB.prepare("DELETE FROM page_invites WHERE token = ? AND page_id = ?")
    .bind(token, pageId)
    .run();

  await recordAuditEvent(env, {
    pageId,
    actorUserId,
    action: "invite.revoked",
    metadata: { token },
  });

  return { success: true } as const;
}

export async function acceptInvite(
  env: any,
  token: string,
  userId: string
) {
  const invite = await env.DB.prepare(
    "SELECT token, page_id, email, role, expires_at FROM page_invites WHERE token = ? LIMIT 1"
  )
    .bind(token)
    .first<{
      token: string;
      page_id: string;
      email: string;
      role: Role;
      expires_at: string | null;
    }>();

  if (!invite) {
    return { error: "초대를 찾을 수 없습니다", status: 404 } as const;
  }

  if (invite.expires_at) {
    const expiresTime = Date.parse(invite.expires_at);
    if (Number.isFinite(expiresTime) && Date.now() > expiresTime) {
      await env.DB.prepare("DELETE FROM page_invites WHERE token = ?").bind(token).run();
      return { error: "초대가 만료되었습니다", status: 410 } as const;
    }
  }

  const userEmail = await getUserEmail(env, userId);
  if (!userEmail || userEmail.toLowerCase() !== invite.email.toLowerCase()) {
    return { error: "초대된 이메일과 일치하지 않습니다", status: 403 } as const;
  }

  await env.DB.prepare(
    "INSERT OR REPLACE INTO page_members (page_id, user_id, role) VALUES (?, ?, ?)"
  )
    .bind(invite.page_id, userId, invite.role)
    .run();

  await env.DB.prepare(
    "INSERT OR IGNORE INTO page_admins (page_id, user_id) VALUES (?, ?)"
  )
    .bind(invite.page_id, userId)
    .run();

  await env.DB.prepare("DELETE FROM page_invites WHERE token = ?")
    .bind(token)
    .run();

  await recordAuditEvent(env, {
    pageId: invite.page_id,
    actorUserId: userId,
    action: "invite.accepted",
    metadata: { role: invite.role },
  });

  return { pageId: invite.page_id, role: invite.role } as const;
}

export async function removeMember(
  env: any,
  pageId: string,
  targetUserId: string,
  actorUserId: string
) {
  const role = await getMemberRole(env, pageId, actorUserId);
  if (!canManageMembers(role)) {
    return { error: "멤버 관리 권한이 없습니다", status: 403 } as const;
  }

  await env.DB.prepare(
    "DELETE FROM page_members WHERE page_id = ? AND user_id = ?"
  )
    .bind(pageId, targetUserId)
    .run();

  await env.DB.prepare(
    "DELETE FROM page_admins WHERE page_id = ? AND user_id = ?"
  )
    .bind(pageId, targetUserId)
    .run();

  await recordAuditEvent(env, {
    pageId,
    actorUserId,
    action: "member.removed",
    metadata: { targetUserId },
  });

  return { success: true } as const;
}
