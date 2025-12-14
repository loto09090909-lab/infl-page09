export async function createSession(req: Request, env: any) {
  const { sessionId } = await req.json();
  await env.PAGE_KV.put(`session:${sessionId}`, "active");
  return new Response("Session created");
}

export async function getSession(req: Request, env: any, sessionId: string) {
  const session = await env.PAGE_KV.get(`session:${sessionId}`);
  return new Response(session ? "Session active" : "Session expired");
}

export async function clearSession(req: Request, env: any, sessionId: string) {
  await env.PAGE_KV.delete(`session:${sessionId}`);
  return new Response("Session cleared");
}
