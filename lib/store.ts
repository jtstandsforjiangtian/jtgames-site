import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyAction, createRoom, GameError, joinRoom, nameOf, settingsOf, viewRoom, type Action, type Player, type Room } from "./game";

const SCHEMA_VERSION = 1;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY NOT NULL,
  state TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rooms_updated_idx ON rooms (updated_at);
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY NOT NULL,
  applied_at INTEGER NOT NULL
);
`;

let database: DatabaseSync | null = null;

export function databasePath() {
  const configured = process.env.JUKEBOX_DB_PATH;
  if (configured === ":memory:") return configured;
  if (configured) {
    if (!configured.startsWith("/")) throw new GameError("JUKEBOX_DB_PATH 必须是绝对路径。", 503);
    return configured;
  }
  return join(process.cwd(), "data", "jukebox.sqlite");
}

export function openDatabase() {
  if (database) return database;
  const path = databasePath();
  try {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA foreign_keys = ON");
    if (path !== ":memory:") {
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA synchronous = NORMAL");
    }
    db.exec(SCHEMA);
    const migrated = db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get(SCHEMA_VERSION) as { version: number } | undefined;
    if (!migrated) db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(SCHEMA_VERSION, Date.now());
    database = db;
    return db;
  } catch (error) {
    console.error("Jukebox database open failed", error instanceof Error ? error.message : "unknown error");
    throw new GameError("房间服务尚未就绪，请稍后重试。", 503);
  }
}

export function closeDatabase() {
  database?.close();
  database = null;
}

function db() {
  return openDatabase();
}

export async function hashToken(token: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}

function codeValue(code: string) {
  if (!/^[A-Z2-9]{6}$/.test(code)) throw new GameError("请输入六位房间码。");
  return code;
}

async function player(name: unknown) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const p: Player = { id: crypto.randomUUID(), name: nameOf(name), tokenHash: await hashToken(token), hand: [], score: 0, lastSeen: Date.now(), readyFor: "" };
  return { p, token };
}

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const n = new Uint8Array(6);
  crypto.getRandomValues(n);
  return Array.from(n, x => chars[x % chars.length]).join("");
}

type RoomRow = { state: string; revision: number };

export async function readRoom(code: string): Promise<Room> {
  const row = db().prepare("SELECT state, revision FROM rooms WHERE code = ?").get(codeValue(code)) as RoomRow | undefined;
  if (!row) throw new GameError("没有找到这个房间，请检查房间码。", 404);
  const room = JSON.parse(row.state) as Room;
  room.groupBag ??= [];
  room.revision = row.revision;
  if (Date.now() - room.updatedAt > 72 * 3600000) throw new GameError("房间已超过 72 小时无人活动，请创建新房间。", 410);
  return room;
}

function identify(room: Room, tokenHash: string) {
  const p = room.players.find(p => p.tokenHash === tokenHash);
  if (!p) throw new GameError("座位凭证无效或座位已被移除，请重新加入。", 401);
  return p.id;
}

function changesOf(result: { changes: number | bigint }) {
  return Number(result.changes);
}

export async function newRoom(name: unknown, setting: unknown) {
  const { p, token } = await player(name);
  const settings = settingsOf(setting);
  for (let attempt = 0; attempt < 5; attempt++) {
    const room = createRoom(makeCode(), p, settings, Date.now());
    const result = db().prepare("INSERT OR IGNORE INTO rooms (code, state, revision, updated_at) VALUES (?, ?, 0, ?)").run(room.code, JSON.stringify(room), room.updatedAt);
    if (changesOf(result)) return { token, room: viewRoom(room, p.id) };
  }
  throw new GameError("创建房间繁忙，请重试。", 503);
}

async function mutate(code: string, fn: (room: Room) => string) {
  for (let attempt = 0; attempt < 7; attempt++) {
    const room = await readRoom(code);
    const oldRevision = room.revision;
    const playerId = fn(room);
    room.revision++;
    room.updatedAt = Date.now();
    const result = db().prepare("UPDATE rooms SET state = ?, revision = ?, updated_at = ? WHERE code = ? AND revision = ?").run(JSON.stringify(room), room.revision, room.updatedAt, code, oldRevision);
    if (changesOf(result)) return viewRoom(room, playerId);
  }
  throw new GameError("刚刚有多人同时操作，请再试一次。", 409);
}

export async function enterRoom(code: string, name: unknown) {
  const { p, token } = await player(name);
  const room = await mutate(code, r => { joinRoom(r, p, Date.now()); return p.id; });
  return { token, room };
}

export async function getRoom(code: string, token: string) {
  const r = await readRoom(code);
  return viewRoom(r, identify(r, await hashToken(token)));
}

export async function actRoom(code: string, token: string, action: Action) {
  const hash = await hashToken(token);
  return mutate(code, r => { const id = identify(r, hash); applyAction(r, id, action); return id; });
}
