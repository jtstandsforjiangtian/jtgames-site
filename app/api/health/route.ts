import { openDatabase } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    openDatabase().prepare("SELECT 1 AS ok").get();
    return Response.json({ ok: true }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("Jukebox health check failed");
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
