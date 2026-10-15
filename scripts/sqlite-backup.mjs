import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const destination = resolve(process.argv[2] || "");
const source = process.env.JUKEBOX_DB_PATH;
if (!source || source === ":memory:" || !destination) {
  console.error("用法: JUKEBOX_DB_PATH=/data/jukebox.sqlite node scripts/sqlite-backup.mjs /backups/jukebox.sqlite");
  process.exit(1);
}
if (!/^[A-Za-z0-9._/-]+$/.test(destination)) {
  console.error("备份路径包含不受支持的字符。");
  process.exit(1);
}
if (existsSync(destination)) {
  console.error("备份文件已存在，拒绝覆盖。");
  process.exit(1);
}
if (!existsSync(source)) {
  console.error("数据库还不存在，没有可备份的内容。");
  process.exit(1);
}

mkdirSync(dirname(destination), { recursive: true });
const db = new DatabaseSync(source);
try {
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(`VACUUM INTO '${destination}'`);
} finally {
  db.close();
}
const check = new DatabaseSync(destination, { readOnly: true });
try {
  const row = check.prepare("SELECT COUNT(*) AS n FROM rooms").get();
  if (!row || typeof row.n !== "number" && typeof row.n !== "bigint") throw new Error("备份缺少 rooms 表");
} finally {
  check.close();
}
process.stdout.write(`${destination}\n`);
