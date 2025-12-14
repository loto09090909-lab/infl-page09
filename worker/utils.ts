export function json(data: any) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}

export function html(content: string) {
  return new Response(content, {
    headers: { "Content-Type": "text/html; charset=UTF-8" },
  });
}
