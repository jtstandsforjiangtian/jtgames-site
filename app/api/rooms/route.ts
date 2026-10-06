import { newRoom } from "@/lib/store";
import { bodyOf, failure, json } from "@/lib/http";
export async function POST(request: Request) {
  try { const b = await bodyOf(request); return json(await newRoom(b.name, b.settings)); } catch (e) { return failure(e); }
}
