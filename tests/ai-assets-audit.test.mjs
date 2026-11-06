import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const temp = mkdtempSync(join(tmpdir(), "jukebox-ai-audit-"));
writeFileSync(join(temp, "package.json"), '{"type":"commonjs"}');
mkdirSync(join(temp, "jukebox-ai"));
for (const name of ["types", "assets", "audit"]) {
  writeFileSync(join(temp, "jukebox-ai", `${name}.js`), ts.transpileModule(
    readFileSync(new URL(`../lib/jukebox-ai/${name}.ts`, import.meta.url), "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } },
  ).outputText);
}
cpSync(new URL("../lib/catalog.json", import.meta.url), join(temp, "catalog.json"));
const require = createRequire(import.meta.url);
const { createAssetRecords, getAssetRecord, applyAssetPatch, toAssetReading, assetNeedsReview } = require(join(temp, "jukebox-ai/assets.js"));
const { AiAuditRepository } = require(join(temp, "jukebox-ai/audit.js"));
const human = { id: "designer", kind: "human" };
const model = { id: "proposal-model", kind: "model" };
const throwsCode = (fn, code) => assert.throws(fn, error => error?.code === code);
const makeEvent = (id = "event-1", botId = "bach") => ({
  version: 1, id, at: "2026-11-06T16:00:00.000Z", roundId: "round-1", botId, task: "speak",
  personaVersion: "personas-v1", promptVersion: "dialogue-v1", model: "fixture-model", elapsedMs: 120,
  request: { task: "speak", messages: [{ role: "user", content: JSON.stringify({ self: { id: botId, role: "audience" }, publicText: "I noticed the window." }) }], schema: { type: "object" } },
  result: { text: "Which musical detail suggests waiting?", addressedPlayerId: "human-1", evidenceIds: ["utterance-1"] },
});

let passed = 0;
const test = (title, run) => { run(); passed++; console.log(`PASS ${title}`); };
const memoryDb = new DatabaseSync(":memory:");
const repository = new AiAuditRepository(memoryDb);
let disk;
try {
  test("all 65 cards and 30 actual excerpts map to stable files, with no fabricated hearing data", () => {
    const assets = createAssetRecords();
    assert.equal(assets.length, 95);
    assert.equal(new Set(assets.map(a => `${a.kind}:${a.id}`)).size, 95);
    assert.equal(assets.filter(a => a.kind === "card").length, 65);
    assert.equal(assets.filter(a => a.kind === "music").length, 30);
    for (const asset of assets) {
      assert.equal(existsSync(new URL(`../public${asset.media.path}`, import.meta.url)), true, asset.id);
      assert.equal(asset.reviewStatus, "unreviewed");
      assert.equal(assetNeedsReview(asset), true);
      if (asset.kind === "music") assert.deepEqual([asset.facts, asset.interpretations], [[], []]);
    }
    assert.equal(getAssetRecord("card", "999"), undefined);
    assert.deepEqual(getAssetRecord("card", "002").facts, []);
    assert.ok(getAssetRecord("card", "001").facts.length);
    assert.equal(/sad|moonlight|knock/i.test(getAssetRecord("card", "001").facts.join(" ")), false);
    assert.equal(/knock/i.test(getAssetRecord("card", "024").facts.join(" ")), false);
    const musicReading = toAssetReading(getAssetRecord("music", "G02_A"));
    assert.equal(JSON.stringify(musicReading).includes("Beethoven"), false);
    assert.equal("media" in musicReading, false);
  });

  test("human confirmation separates observed facts from interpretations; model proposals cannot approve themselves", () => {
    const original = getAssetRecord("card", "001");
    const draftFacts = applyAssetPatch(original, { expectedRevision: "0", facts: ["A seated figure looks through a window."] }, model);
    assert.equal(draftFacts.reviewStatus, "unreviewed");
    assert.equal(draftFacts.descriptionSource, "model-proposal");
    throwsCode(() => applyAssetPatch(original, { expectedRevision: "0", facts: ["A woman sits."] }, human), "FACT_REVIEW_REQUIRED");
    throwsCode(() => applyAssetPatch(original, { expectedRevision: "0", reviewStatus: "reviewed" }, model), "FACT_REVIEW_REQUIRED");
    const proposal = applyAssetPatch(original, { expectedRevision: "0", interpretations: ["Waiting or quiet reflection."] }, model);
    assert.deepEqual(proposal.facts, original.facts);
    assert.equal(proposal.reviewStatus, "unreviewed");
    assert.deepEqual(original.interpretations, []);
    throwsCode(() => applyAssetPatch(proposal, { expectedRevision: "1", reviewStatus: "reviewed" }, human), "FACT_REVIEW_REQUIRED");
    const accepted = applyAssetPatch(proposal, { expectedRevision: "1", reviewStatus: "reviewed", confirmObservedFacts: true, reviewNote: "Keep both readings open." }, human);
    assert.equal(assetNeedsReview(accepted), false);
    throwsCode(() => applyAssetPatch(accepted, { expectedRevision: "1", reviewNote: "stale" }, human), "ASSET_REVISION_CONFLICT");
    throwsCode(() => applyAssetPatch(original, { expectedRevision: "0", media: { path: "/other.jpg" } }, human), "INVALID_ASSET_PATCH");
    throwsCode(() => applyAssetPatch(getAssetRecord("music", "G01_A"), { expectedRevision: "0", reviewStatus: "reviewed", confirmObservedFacts: true }, human), "EMPTY_ASSET_REVIEW");
  });

  test("SQLite asset review persists ambiguity and rejects stale changes without startup overwrite", () => {
    assert.equal(repository.seedAssets(), 95);
    const first = repository.patchAsset("card", "001", { expectedRevision: "0", reviewStatus: "disputed", reviewNote: "The scene could be peaceful, not necessarily sad." }, human);
    assert.equal(first.revision, "1");
    throwsCode(() => repository.patchAsset("card", "001", { expectedRevision: "0", reviewStatus: "reviewed" }, human), "ASSET_REVISION_CONFLICT");
    assert.equal(repository.seedAssets(), 0);
    assert.deepEqual(repository.getAsset("card", "001"), first);
    assert.equal(repository.listAssets("music").length, 30);
    const exported = JSON.parse(repository.exportAssetsJson());
    assert.equal(exported.records.length, 95);
    assert.deepEqual(exported.records.find(a => a.kind === "card" && a.id === "001"), first);
  });

  test("immutable events are idempotent, distinguish bots and preserve recorded inputs, output and latency", () => {
    const event = makeEvent();
    const stored = repository.append(event, { firstTextMs: 70, transcriptionMs: 300 });
    assert.deepEqual(stored.event, event);
    assert.equal(stored.timings.firstTextMs, 70);
    assert.match(stored.digest, /^[a-f0-9]{64}$/);
    assert.equal(stored.originalDigest, stored.digest);
    assert.equal(stored.recording, "exact");
    assert.deepEqual(stored.redactions, { count: 0, paths: [] });
    assert.deepEqual(repository.append(event, { firstTextMs: 70, transcriptionMs: 300 }), stored);
    throwsCode(() => repository.append({ ...event, result: { text: "different output" } }), "AUDIT_EVENT_CONFLICT");
    repository.append(makeEvent("event-2", "clara"));
    assert.deepEqual(repository.listRound("round-1").map(r => r.event.id), ["event-1", "event-2"]);
    assert.deepEqual(repository.listRound("round-1", "bach").map(r => r.event.id), ["event-1"]);
    assert.deepEqual(repository.listRound("unknown"), []);
  });

  test("structured credential fields are still rejected before writing", () => {
    const event = makeEvent("event-secret");
    throwsCode(() => repository.append({ ...event, request: { ...event.request, headers: { Authorization: "not-logged" } } }), "INVALID_AUDIT_EVENT");
    throwsCode(() => repository.append({ ...event, result: { api_key: "not-logged" } }), "AUDIT_CREDENTIAL_REJECTED");
    assert.equal(repository.get(event.id), undefined);
    assert.equal(repository.listRound("round-1").length, 2);
  });

  test("credential-like public text is redacted without failing the action, with explicit provenance and original-input idempotency", () => {
    const bearer = "Bearer abcdefghijklmnopqrstuvwxyz";
    const key = "sk-abcdefghijklmnop1234567890";
    const event = {
      ...makeEvent("event-redacted"), roundId: "round-redacted",
      request: { ...makeEvent().request, messages: [{ role: "user", content: `The player quoted ${bearer}, then described a window.` }] },
      result: { text: `I heard the quoted phrase ${key}; let's return to the picture.` },
    };
    const stored = repository.append(event);
    assert.equal(stored.recording, "redacted");
    assert.equal(stored.redactions.count, 2);
    assert.deepEqual(stored.redactions.paths, ["/request/messages/0/content", "/result/text"]);
    assert.notEqual(stored.digest, stored.originalDigest);
    assert.match(stored.event.request.messages[0].content, /\[REDACTED_CREDENTIAL\]/);
    assert.match(stored.event.result.text, /\[REDACTED_CREDENTIAL\]/);
    assert.deepEqual(repository.append(event), stored);
    const collision = { ...event, result: { text: event.result.text.replace(key, "sk-zyxwvutsrqponmlk0987654321") } };
    throwsCode(() => repository.append(collision), "AUDIT_EVENT_CONFLICT");
    const exported = repository.exportRoundJson(event.roundId);
    assert.equal(exported.includes(bearer), false);
    assert.equal(exported.includes(key), false);
    assert.equal(JSON.parse(exported).events[0].recording, "redacted");
    const raw = memoryDb.prepare("SELECT event_json, redactions_json FROM jukebox_ai_events WHERE id = ?").get(event.id);
    assert.equal(JSON.stringify(raw).includes(key), false);
    const reviewed = repository.reviewEvent(event.id, { expectedRevision: 0, tags: ["other"], note: `The user quoted ${bearer}.` }, human.id);
    assert.equal(reviewed.review.redactions.count, 1);
    assert.match(reviewed.review.note, /\[REDACTED_CREDENTIAL\]/);
    assert.equal(repository.exportRoundJson(event.roundId).includes(bearer), false);
  });

  test("event review CAS keeps the original result unchanged and export is a recorded replay", () => {
    const original = repository.get("event-1");
    const reviewed = repository.reviewEvent("event-1", { expectedRevision: 0, tags: ["fits-persona"], note: "Good question grounded in the player's explanation." }, human.id);
    assert.equal(reviewed.review.revision, 1);
    assert.equal(reviewed.digest, original.digest);
    assert.deepEqual(reviewed.event, original.event);
    throwsCode(() => repository.reviewEvent("event-1", { expectedRevision: 0, tags: ["ignored-player"], note: "stale" }, "other-reviewer"), "AUDIT_REVISION_CONFLICT");
    const exported = JSON.parse(repository.exportRoundJson("round-1"));
    assert.equal(exported.replay, "recorded-results");
    assert.equal(exported.events[0].event.result.text, original.event.result.text);
    assert.equal(exported.events[0].review.note, reviewed.review.note);
    assert.deepEqual(exported.events.map(e => e.event.id), ["event-1", "event-2"]);
  });

  test("file-backed audit and asset reviews survive closing and reopening independently of room storage", () => {
    const path = join(temp, "private-audit.sqlite");
    disk = new AiAuditRepository(path);
    disk.seedAssets();
    disk.patchAsset("music", "G02_A", { expectedRevision: "0", reviewStatus: "disputed", reviewNote: "Listen to this exact excerpt before adding an interpretation." }, human);
    disk.append(makeEvent("restart-event"));
    disk.reviewEvent("restart-event", { expectedRevision: 0, tags: ["other"], note: "Needs another playtest." }, human.id);
    disk.close();
    disk = new AiAuditRepository(path);
    assert.equal(disk.get("restart-event").review.note, "Needs another playtest.");
    assert.equal(disk.getAsset("music", "G02_A").revision, "1");
    assert.equal(disk.getAsset("music", "G02_A").reviewStatus, "disputed");
    assert.equal(disk.seedAssets(), 0);
    assert.equal(disk.listRound("round-1").length, 1);
  });

  test("pre-redaction schema migrates existing exact recordings without losing their reviews", () => {
    const legacyDb = new DatabaseSync(":memory:");
    let upgraded;
    try {
      legacyDb.exec(`CREATE TABLE jukebox_ai_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
        round_id TEXT NOT NULL, bot_id TEXT NOT NULL, event_json TEXT NOT NULL,
        digest TEXT NOT NULL, timings_json TEXT NOT NULL, review_json TEXT NOT NULL,
        review_revision INTEGER NOT NULL DEFAULT 0
      )`);
      const existing = repository.get("event-1");
      legacyDb.prepare("INSERT INTO jukebox_ai_events(id, round_id, bot_id, event_json, digest, timings_json, review_json, review_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(existing.event.id, existing.event.roundId, existing.event.botId, JSON.stringify(existing.event), existing.digest, JSON.stringify(existing.timings), JSON.stringify(existing.review), existing.review.revision);
      upgraded = new AiAuditRepository(legacyDb);
      assert.equal(upgraded.get(existing.event.id).originalDigest, existing.digest);
      assert.equal(upgraded.get(existing.event.id).recording, "exact");
      assert.deepEqual(upgraded.get(existing.event.id).review, existing.review);
      assert.deepEqual(upgraded.append(existing.event, existing.timings).redactions, { count: 0, paths: [] });
    } finally { upgraded?.close(); legacyDb.close(); }
  });

  test("repository does not close a database instance owned by its caller", () => {
    repository.close();
    assert.equal(memoryDb.prepare("SELECT 1 AS alive").get().alive, 1);
    throwsCode(() => repository.listAssets(), "AUDIT_STORE_CLOSED");
  });
  console.log(`\n${passed} AI asset and private-audit scenarios passed.`);
} finally {
  repository.close();
  memoryDb.close();
  disk?.close();
  rmSync(temp, { recursive: true, force: true });
}
