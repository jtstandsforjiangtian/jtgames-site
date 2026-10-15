import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const temp = mkdtempSync(join(tmpdir(), "jukebox-backup-"));
const dbPath = join(temp, "jukebox.sqlite");
const backupPath = join(temp, "backup.sqlite");
const script = new URL("../scripts/sqlite-backup.mjs", import.meta.url);

function run(args, env = {}) {
  return spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", ...args], {
    env: { ...process.env, JUKEBOX_DB_PATH: dbPath, ...env },
    encoding: "utf8",
  });
}

try {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE rooms (code TEXT PRIMARY KEY, state TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
  db.prepare("INSERT INTO rooms (code, state, revision, updated_at) VALUES (?, ?, ?, ?)").run("ABCD23", JSON.stringify({ score: 4 }), 2, Date.now());
  db.close();

  const backup = run([script.pathname, backupPath]);
  assert.equal(backup.status, 0, backup.stderr);
  assert.equal(backup.stdout.trim(), backupPath);

  const live = new DatabaseSync(dbPath);
  live.prepare("UPDATE rooms SET state = ?, revision = revision + 1 WHERE code = ?").run(JSON.stringify({ score: 9 }), "ABCD23");
  live.close();

  rmSync(dbPath);
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  copyFileSync(backupPath, dbPath);
  const restored = new DatabaseSync(dbPath, { readOnly: true });
  const row = restored.prepare("SELECT state, revision FROM rooms WHERE code = ?").get("ABCD23");
  restored.close();
  assert.equal(JSON.parse(row.state).score, 4);
  assert.equal(row.revision, 2);
  console.log("PASS SQLite VACUUM INTO backup restores the score from before later writes");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
