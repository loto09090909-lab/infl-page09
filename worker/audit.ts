type AuditEvent = {
  pageId: string;
  actorUserId: string;
  action: string;
  metadata?: Record<string, unknown>;
};

export async function recordAuditEvent(env: any, event: AuditEvent) {
  await env.DB.prepare(
    "INSERT INTO audit_logs (id, page_id, actor_user_id, action, metadata) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(
      crypto.randomUUID(),
      event.pageId,
      event.actorUserId,
      event.action,
      event.metadata ? JSON.stringify(event.metadata) : null
    )
    .run();
}
