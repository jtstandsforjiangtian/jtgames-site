/** Node-only private audit storage. Never import this module into a client component. */
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyAssetPatch, createAssetRecords, type AssetKind, type AssetRecord, type ReviewActor } from "./assets";
import { BotError, type AuditEvent, type JsonModelRequest } from "./types";

export const AUDIT_REVIEW_TAGS = ["fits-persona", "invented-detail", "ignored-player", "repetitive", "information-leak", "other"] as const;
export type AuditReviewTag = typeof AUDIT_REVIEW_TAGS[number];
export const AUDIT_REVIEW_LABELS: Record<AuditReviewTag, string> = {
  "fits-persona": "符合性格", "invented-detail": "编造细节", "ignored-player": "忽略玩家理由",
  repetitive: "对话重复", "information-leak": "疑似信息泄漏", other: "其他",
};
export type AuditTimings = { firstTextMs?: number; transcriptionMs?: number; speechStartMs?: number };
export type AuditRedactions = { count: number; paths: string[] };
export type AuditReview = { revision: number; tags: AuditReviewTag[]; note: string; reviewerId: string | null; updatedAt: string | null; redactions?: AuditRedactions; originalDigest?: string };
export type RecordedAuditEvent = {
  sequence: number; event: AuditEvent; digest: string; originalDigest: string;
  recording: "exact" | "redacted"; redactions: AuditRedactions; timings: AuditTimings; review: AuditReview;
};
export type AuditReviewPatch = { expectedRevision: number; tags: AuditReviewTag[]; note: string };

const schema = `
CREATE TABLE IF NOT EXISTS jukebox_ai_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT UNIQUE NOT NULL,
  round_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  event_json TEXT NOT NULL,
  digest TEXT NOT NULL,
  original_digest TEXT,
  redactions_json TEXT NOT NULL DEFAULT '{"count":0,"paths":[]}',
  timings_json TEXT NOT NULL,
  review_json TEXT NOT NULL,
  review_revision INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS jukebox_ai_events_round_idx ON jukebox_ai_events(round_id, sequence);
CREATE TABLE IF NOT EXISTS jukebox_ai_assets (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  revision TEXT NOT NULL,
  record_json TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);`;
type EventRow = { sequence: number; event_json: string; digest: string; original_digest: string | null; redactions_json: string; timings_json: string; review_json: string };
const eventColumns = "sequence, event_json, digest, original_digest, redactions_json, timings_json, review_json";
const credentialText = /\bBearer\s+[A-Za-z0-9._~+\/=\-]{12,}|\bsk-[A-Za-z0-9_-]{16,}/g;
const hasCredentialText = (value: string) => new RegExp(credentialText.source).test(value);

function requireText(value: unknown, field: string, max = 160): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new BotError("INVALID_AUDIT_EVENT", `Invalid ${field}.`);
  // These are server identifiers/configuration labels, not player speech.
  if (hasCredentialText(value)) throw new BotError("AUDIT_CREDENTIAL_REJECTED", "Credential-like data cannot be used as an audit identifier.");
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new BotError("INVALID_AUDIT_EVENT", "Unexpected audit field; transport settings must not be logged.");
}

const credentialKey = /^(authorization|proxyauthorization|apikey|accesskey|secretkey|privatekey|accesstoken|refreshtoken|seattoken|tokenhash|token|password|credential|cookie|setcookie)s?$/i;
function checkedJson(value: unknown, seen = new Set<object>(), depth = 0): unknown {
  if (depth > 40) throw new BotError("INVALID_AUDIT_EVENT", "Audit data is too deeply nested.");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === undefined || !value) throw new BotError("INVALID_AUDIT_EVENT", "Audit values must be JSON data.");
  if (seen.has(value)) throw new BotError("INVALID_AUDIT_EVENT", "Circular audit data is not supported.");
  seen.add(value);
  let result: unknown;
  if (Array.isArray(value)) result = value.map(item => checkedJson(item, seen, depth + 1));
  else {
    if (!object(value)) throw new BotError("INVALID_AUDIT_EVENT", "Audit values must be plain JSON objects.");
    const entries = Object.keys(value).sort().map(key => {
      if (credentialKey.test(key.replace(/[_-]/g, "")) || hasCredentialText(key) || ["__proto__", "constructor", "prototype"].includes(key)) {
        throw new BotError("AUDIT_CREDENTIAL_REJECTED", "Private credentials and unsafe object keys cannot be logged.");
      }
      return [key, checkedJson(value[key], seen, depth + 1)];
    });
    result = Object.fromEntries(entries);
  }
  seen.delete(value);
  return result;
}

/** Redact free text rather than allowing a player's quote to interrupt a legal action. */
function redactJson(value: unknown, redactions: AuditRedactions, path = ""): unknown {
  if (typeof value === "string") {
    return value.replace(credentialText, () => {
      redactions.count++;
      if (!redactions.paths.includes(path)) redactions.paths.push(path);
      return "[REDACTED_CREDENTIAL]";
    });
  }
  if (Array.isArray(value)) return value.map((item, i) => redactJson(item, redactions, `${path}/${i}`));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key, redactJson(item, redactions, `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`),
  ]));
  return value;
}
const digestJson = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function normalizeRequest(value: unknown): JsonModelRequest {
  if (!object(value)) throw new BotError("INVALID_AUDIT_EVENT", "A structured model request is required.");
  onlyKeys(value, ["task", "messages", "schema"]);
  requireText(value.task, "request task");
  if (!Array.isArray(value.messages) || value.messages.length > 100 || !object(value.schema)) throw new BotError("INVALID_AUDIT_EVENT", "Invalid model request.");
  for (const message of value.messages) {
    if (!object(message)) throw new BotError("INVALID_AUDIT_EVENT", "Invalid message.");
    onlyKeys(message, ["role", "content"]);
    if (!["system", "user", "assistant"].includes(String(message.role)) || typeof message.content !== "string" || message.content.length > 200_000) throw new BotError("INVALID_AUDIT_EVENT", "Invalid message.");
  }
  return checkedJson(value) as JsonModelRequest;
}
function normalizeEvent(value: unknown): AuditEvent {
  if (!object(value)) throw new BotError("INVALID_AUDIT_EVENT", "An audit event is required.");
  onlyKeys(value, ["version", "id", "at", "roundId", "botId", "task", "personaVersion", "promptVersion", "model", "request", "result", "elapsedMs", "requestId"]);
  if (value.version !== 1 || !["assess-hand", "speak", "judge"].includes(String(value.task))) throw new BotError("INVALID_AUDIT_EVENT", "Unknown event version or task.");
  for (const field of ["id", "at", "roundId", "botId", "personaVersion", "promptVersion", "model"]) requireText(value[field], field);
  if (!Number.isFinite(Date.parse(value.at as string)) || typeof value.elapsedMs !== "number" || !Number.isFinite(value.elapsedMs) || value.elapsedMs < 0) throw new BotError("INVALID_AUDIT_EVENT", "Invalid event time.");
  if (value.requestId !== undefined) requireText(value.requestId, "requestId");
  const event: Record<string, unknown> = { ...value, request: normalizeRequest(value.request) };
  // Optional undefined fields are omitted; all remaining values must really be JSON.
  if (event.requestId === undefined) delete event.requestId;
  const normalized = checkedJson(event) as AuditEvent;
  if (JSON.stringify(normalized).length > 2_000_000) throw new BotError("INVALID_AUDIT_EVENT", "Audit event is too large.");
  return normalized;
}
function normalizeTimings(value: AuditTimings): AuditTimings {
  if (!object(value)) throw new BotError("INVALID_AUDIT_EVENT", "Invalid timing data.");
  onlyKeys(value, ["firstTextMs", "transcriptionMs", "speechStartMs"]);
  const result: AuditTimings = {};
  for (const key of ["firstTextMs", "transcriptionMs", "speechStartMs"] as const) {
    const ms = value[key];
    if (ms !== undefined) {
      if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) throw new BotError("INVALID_AUDIT_EVENT", "Invalid latency value.");
      result[key] = ms;
    }
  }
  return result;
}
function decode(row: EventRow): RecordedAuditEvent {
  const redactions = JSON.parse(row.redactions_json) as AuditRedactions;
  return {
    sequence: row.sequence, event: JSON.parse(row.event_json), digest: row.digest,
    originalDigest: row.original_digest ?? row.digest, recording: redactions.count ? "redacted" : "exact", redactions,
    timings: JSON.parse(row.timings_json), review: JSON.parse(row.review_json),
  };
}

/** Private storage only. Access control must be enforced by any future server route. */
export class AiAuditRepository {
  private readonly db: DatabaseSync;
  private readonly ownsDatabase: boolean;
  private closed = false;

  constructor(database: DatabaseSync | string) {
    this.ownsDatabase = typeof database === "string";
    if (typeof database === "string") {
      if (database !== ":memory:" && !isAbsolute(database)) throw new BotError("INVALID_AUDIT_PATH", "Use an absolute audit database path.");
      if (database !== ":memory:") mkdirSync(dirname(database), { recursive: true });
      this.db = new DatabaseSync(database);
      this.db.exec("PRAGMA busy_timeout = 5000");
    } else this.db = database;
    this.db.exec(schema);
    // Existing foundation databases contain exact recordings: the previous version rejected these strings.
    const columns = new Set((this.db.prepare("PRAGMA table_info(jukebox_ai_events)").all() as { name: string }[]).map(column => column.name));
    if (!columns.has("original_digest")) this.db.exec("ALTER TABLE jukebox_ai_events ADD COLUMN original_digest TEXT");
    if (!columns.has("redactions_json")) this.db.exec("ALTER TABLE jukebox_ai_events ADD COLUMN redactions_json TEXT NOT NULL DEFAULT '{\"count\":0,\"paths\":[]}'");
    this.db.exec("UPDATE jukebox_ai_events SET original_digest = digest WHERE original_digest IS NULL");
  }

  private ready() {
    if (this.closed) throw new BotError("AUDIT_STORE_CLOSED", "The audit repository is closed.");
  }

  seedAssets(records: AssetRecord[] = createAssetRecords()): number {
    this.ready();
    const insert = this.db.prepare("INSERT OR IGNORE INTO jukebox_ai_assets(kind, id, revision, record_json) VALUES (?, ?, ?, ?)");
    let inserted = 0;
    const baseline = new Map(createAssetRecords().map(record => [`${record.kind}:${record.id}`, record]));
    this.db.exec("SAVEPOINT jukebox_ai_seed_assets");
    try {
      for (const record of records) {
        const known = baseline.get(`${record.kind}:${record.id}`);
        if (!known || record.revision !== "0") throw new BotError("INVALID_ASSET_SEED", "Only initial records for known catalog assets may be seeded.");
        // Always seed the checked catalog baseline, never replace reviewed data with arbitrary input.
        inserted += Number(insert.run(known.kind, known.id, known.revision, JSON.stringify(known)).changes);
      }
      this.db.exec("RELEASE SAVEPOINT jukebox_ai_seed_assets");
    } catch (error) {
      this.db.exec("ROLLBACK TO SAVEPOINT jukebox_ai_seed_assets; RELEASE SAVEPOINT jukebox_ai_seed_assets");
      throw error;
    }
    return inserted;
  }

  getAsset(kind: AssetKind, id: string): AssetRecord | undefined {
    this.ready();
    const row = this.db.prepare("SELECT record_json FROM jukebox_ai_assets WHERE kind = ? AND id = ?").get(kind, id) as { record_json: string } | undefined;
    return row ? JSON.parse(row.record_json) : undefined;
  }

  listAssets(kind?: AssetKind): AssetRecord[] {
    this.ready();
    const rows = kind
      ? this.db.prepare("SELECT record_json FROM jukebox_ai_assets WHERE kind = ? ORDER BY id").all(kind)
      : this.db.prepare("SELECT record_json FROM jukebox_ai_assets ORDER BY kind, id").all();
    return (rows as { record_json: string }[]).map(row => JSON.parse(row.record_json));
  }

  patchAsset(kind: AssetKind, id: string, patch: unknown, actor: ReviewActor): AssetRecord {
    const current = this.getAsset(kind, id);
    if (!current) throw new BotError("ASSET_NOT_FOUND", "Unknown asset.");
    const next = applyAssetPatch(current, patch, actor);
    const saved = this.db.prepare("UPDATE jukebox_ai_assets SET record_json = ?, revision = ? WHERE kind = ? AND id = ? AND revision = ?")
      .run(JSON.stringify(next), next.revision, kind, id, current.revision);
    if (Number(saved.changes) !== 1) throw new BotError("ASSET_REVISION_CONFLICT", "This asset was changed. Read the latest version.");
    return next;
  }

  append(input: AuditEvent, timingInput: AuditTimings = {}): RecordedAuditEvent {
    this.ready();
    const originalEvent = normalizeEvent(input);
    const timings = normalizeTimings(timingInput);
    const canonicalTimings = checkedJson(timings);
    const originalDigest = digestJson({ event: originalEvent, timings: canonicalTimings });
    const redactions: AuditRedactions = { count: 0, paths: [] };
    const event = redactJson(originalEvent, redactions) as AuditEvent;
    const body = JSON.stringify(event);
    const timingBody = JSON.stringify(canonicalTimings);
    const digest = digestJson({ event, timings: canonicalTimings });
    const initial: AuditReview = { revision: 0, tags: [], note: "", reviewerId: null, updatedAt: null };
    this.db.prepare("INSERT OR IGNORE INTO jukebox_ai_events(id, round_id, bot_id, event_json, digest, original_digest, redactions_json, timings_json, review_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(event.id, event.roundId, event.botId, body, digest, originalDigest, JSON.stringify(redactions), timingBody, JSON.stringify(initial));
    const recorded = this.get(event.id)!;
    if (recorded.originalDigest !== originalDigest) throw new BotError("AUDIT_EVENT_CONFLICT", "This event ID already identifies a different recorded result.");
    return recorded;
  }

  get(id: string): RecordedAuditEvent | undefined {
    this.ready();
    const row = this.db.prepare(`SELECT ${eventColumns} FROM jukebox_ai_events WHERE id = ?`).get(id) as EventRow | undefined;
    return row ? decode(row) : undefined;
  }

  listRound(roundId: string, botId?: string): RecordedAuditEvent[] {
    this.ready();
    const rows = botId
      ? this.db.prepare(`SELECT ${eventColumns} FROM jukebox_ai_events WHERE round_id = ? AND bot_id = ? ORDER BY sequence`).all(roundId, botId)
      : this.db.prepare(`SELECT ${eventColumns} FROM jukebox_ai_events WHERE round_id = ? ORDER BY sequence`).all(roundId);
    return (rows as EventRow[]).map(decode);
  }

  reviewEvent(id: string, input: AuditReviewPatch, reviewerId: string): RecordedAuditEvent {
    this.ready();
    if (!object(input)) throw new BotError("INVALID_AUDIT_REVIEW", "A review patch is required.");
    onlyKeys(input, ["expectedRevision", "tags", "note"]);
    requireText(reviewerId, "reviewerId");
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision >= Number.MAX_SAFE_INTEGER || !Array.isArray(input.tags)
      || input.tags.some(tag => !AUDIT_REVIEW_TAGS.includes(tag)) || typeof input.note !== "string" || input.note.length > 4000) {
      throw new BotError("INVALID_AUDIT_REVIEW", "Invalid review revision, tags or note.");
    }
    const current = this.get(id);
    if (!current) throw new BotError("AUDIT_EVENT_NOT_FOUND", "Unknown audit event.");
    const review: AuditReview = {
      revision: input.expectedRevision + 1, tags: [...new Set(input.tags)], note: input.note.trim(),
      reviewerId, updatedAt: new Date().toISOString(),
    };
    const checkedReview = checkedJson(review);
    const redactions: AuditRedactions = { count: 0, paths: [] };
    const safeReview = redactJson(checkedReview, redactions) as AuditReview;
    if (redactions.count) {
      safeReview.redactions = redactions;
      safeReview.originalDigest = digestJson(checkedReview);
    }
    const body = JSON.stringify(safeReview);
    const saved = this.db.prepare("UPDATE jukebox_ai_events SET review_json = ?, review_revision = ? WHERE id = ? AND review_revision = ?")
      .run(body, review.revision, id, input.expectedRevision);
    if (Number(saved.changes) !== 1) throw new BotError("AUDIT_REVISION_CONFLICT", "This review was changed. Read the latest version.");
    return this.get(id)!;
  }

  /** Returns stored responses, never invokes a model or pretends a rerun is identical. */
  exportRoundJson(roundId: string): string {
    return JSON.stringify({
      format: "jukebox-ai-audit", version: 1, replay: "recorded-results", roundId,
      exportedAt: new Date().toISOString(), events: this.listRound(roundId),
    }, null, 2);
  }

  exportAssetsJson(): string {
    return JSON.stringify({
      format: "jukebox-ai-assets", version: 1, exportedAt: new Date().toISOString(), records: this.listAssets(),
    }, null, 2);
  }

  close() {
    if (!this.closed && this.ownsDatabase) this.db.close();
    this.closed = true;
  }
}
