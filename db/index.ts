export function getDb(): never {
  throw new Error("Cloudflare D1 已停用。房间数据由 lib/store.ts 写入本机 SQLite。");
}
