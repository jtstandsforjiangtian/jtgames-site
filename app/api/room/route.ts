import { actRoom, enterRoom, getRoom } from "@/lib/store";
import { bodyOf, failure, json, tokenOf } from "@/lib/http";
import { GameError } from "@/lib/game";
const codeOf = (request: Request) => (new URL(request.url).searchParams.get("code") || "").toUpperCase();
export async function GET(request: Request) {
  try { return json({ room: await getRoom(codeOf(request), tokenOf(request)) }); } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  try {
    const b = await bodyOf(request); const code = codeOf(request);
    if (b.type === "join") return json(await enterRoom(code, b.name));
    if (typeof b.type !== "string") throw new GameError("缺少操作类型。");
    if (b.type !== "heartbeat" && (typeof b.requestId !== "string" || b.requestId.length > 80)) throw new GameError("缺少操作编号，请刷新后重试。");
    return json({ room: await actRoom(code, tokenOf(request), { ...b, type: b.type }) });
  } catch (e) { return failure(e); }
}
