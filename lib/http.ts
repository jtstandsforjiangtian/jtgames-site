import { GameError } from "./game";
export function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "no-store, private", "Vary": "Authorization", "X-Content-Type-Options": "nosniff" } }); }
export function failure(error: unknown) {
  if (error instanceof GameError) return json({ error: error.message }, error.status);
  console.error("Jukebox request failed", error instanceof Error ? error.message : "unknown error");
  return json({ error: "服务暂时无法完成操作，请稍后重试。" }, 500);
}
export async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > 16384) throw new GameError("请求内容过大。", 413);
  const reader = request.body?.getReader(); if (!reader) throw new GameError("请求为空。");
  let total = 0; const parts: Uint8Array[] = [];
  while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > 16384) { await reader.cancel(); throw new GameError("请求内容过大。", 413); } parts.push(value); }
  const bytes = new Uint8Array(total); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { const b = JSON.parse(new TextDecoder().decode(bytes)); if (!b || typeof b !== "object" || Array.isArray(b)) throw new Error(); return b; } catch { throw new GameError("请求格式有误。"); }
}
export function tokenOf(request: Request) { const token = request.headers.get("Authorization")?.replace(/^Bearer /, ""); if (!token || token.length > 150) throw new GameError("请先加入房间。", 401); return token; }
