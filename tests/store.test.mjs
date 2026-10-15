import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const temp = mkdtempSync(join(tmpdir(), "jukebox-sqlite-"));
const dbPath = join(temp, "jukebox.sqlite");
process.env.JUKEBOX_DB_PATH = dbPath;
writeFileSync(join(temp, "package.json"), '{"type":"commonjs"}');
for (const name of ["game", "catalog-utils", "store"]) {
  writeFileSync(join(temp, `${name}.js`), ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText);
}
cpSync(new URL("../lib/catalog.json", import.meta.url), join(temp, "catalog.json"));
const require = createRequire(import.meta.url);
const storePath = join(temp, "store.js");
const { newRoom, enterRoom, getRoom, actRoom, closeDatabase } = require(storePath);

function reopenInNewProcess(code, token) {
  const runner = `
    const store = require(${JSON.stringify(storePath)});
    store.getRoom(${JSON.stringify(code)}, ${JSON.stringify(token)}).then(room => {
      process.stdout.write(JSON.stringify({ id: room.self.id, score: room.players.find(p => p.id === room.self.id).score, players: room.players.length, revision: room.revision }));
      store.closeDatabase();
    }).catch(error => { console.error(error && error.message ? error.message : error); process.exit(1); });
  `;
  const result = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "-e", runner], {
    env: { ...process.env, JUKEBOX_DB_PATH: dbPath },
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "restart process failed");
  return JSON.parse(result.stdout);
}

try {
  const host = await newRoom("主持", { mode: "identity" });
  const code = host.room.code;
  const guests = await Promise.all(Array.from({ length: 7 }, (_, i) => enterRoom(code, `来宾${i + 1}`)));
  const all = [host, ...guests];
  assert.equal((await getRoom(code, host.token)).players.length, 8);
  console.log("PASS 8 concurrent joins with atomic compare-and-swap, no lost seats");
  await assert.rejects(() => getRoom(code, "wrong-secret"), /凭证无效/);
  console.log("PASS invalid seat credential cannot read room data");
  const s = async (who, type, extra = {}, id = crypto.randomUUID()) => actRoom(code, who.token, { type, requestId: id, ...extra });
  await s(host, "start");
  await s(host, "advance");
  const views = await Promise.all(all.map(p => getRoom(code, p.token)));
  const author = all[views.findIndex(v => v.self.role === "author")];
  const spy = all[views.findIndex(v => v.self.role === "spy")];
  const ordinary = all.find(p => p !== author && p !== spy);
  const av = await getRoom(code, author.token);
  await s(author, "select", { target: "C", cardId: av.self.hand[0] });
  await Promise.all(all.filter(p => p !== author).map(async p => {
    const v = await getRoom(code, p.token);
    return s(p, "select", { cardId: v.self.hand[0] });
  }));
  const selected = await getRoom(code, host.token);
  assert.equal(selected.round.selectedCount, 8);
  assert.ok(selected.players.every(p => p.card === null && p.role === null));
  assert.equal((await getRoom(code, spy.token)).self.target, "C");
  const ordinaryView = await getRoom(code, ordinary.token);
  assert.equal(ordinaryView.self.target, null);
  assert.equal(ordinaryView.self.hand.includes(av.self.hand[0]), false);
  assert.equal(JSON.stringify(ordinaryView).includes("tokenHash"), false);
  console.log("PASS parallel card submissions, credential isolation and persisted secret delivery");
  await s(host, "advance");
  await s(host, "advance");
  const id = "same-score-on-retry";
  await Promise.all([
    s(host, "score", { playerId: host.room.self.id, delta: 3 }, id),
    s(host, "score", { playerId: host.room.self.id, delta: 3 }, id),
  ]);
  assert.equal((await getRoom(code, host.token)).players.find(p => p.id === host.room.self.id).score, 3);
  console.log("PASS duplicate concurrent requests cannot double manual scores");
  const voters = all.filter((_, i) => views[i].self.role !== "spy");
  await Promise.all(voters.map(p => s(p, "vote", { value: "abstain" })));
  assert.equal((await getRoom(code, host.token)).round.ballot.submitted, 7);
  await assert.rejects(() => s(guests[0], "end"), /房主/);
  await assert.rejects(() => s(guests[0], "score", { playerId: guests[0].room.self.id, delta: 5 }), /房主/);
  await s(host, "advance");
  assert.equal((await getRoom(code, spy.token)).round.phase, "results");
  assert.equal((await getRoom(code, host.token)).round.ballot.results[host.room.self.id], views[0].self.role === "spy" ? undefined : "abstain");
  console.log("PASS persisted end-to-end 8-player round and reconnect view");
  const who = host.room.self.id;
  await s(host, "scoreSet", { playerId: who, score: 18, expectedScore: 3 });
  assert.equal((await getRoom(code, guests[0].token)).players.find(p => p.id === who).score, 18);
  const competing = await Promise.allSettled([
    s(host, "scoreSet", { playerId: who, score: 20, expectedScore: 18 }),
    s(host, "scoreSet", { playerId: who, score: 25, expectedScore: 18 }),
  ]);
  assert.equal(competing.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(competing.filter(r => r.status === "rejected").length, 1);
  const latest = (await getRoom(code, host.token)).players.find(p => p.id === who).score;
  await s(host, "scoreSet", { playerId: who, score: 0, expectedScore: latest });
  assert.equal((await getRoom(code, guests[1].token)).players.find(p => p.id === who).score, 0);
  console.log("PASS absolute score edits persist, sync across seats, reject stale writes, and reset to zero");

  const guessHost = await newRoom("出题", { mode: "guess" });
  const guessCode = guessHost.room.code;
  const guessGuest = await enterRoom(guessCode, "猜测");
  const g = async (who, type, extra = {}) => actRoom(guessCode, who.token, { type, requestId: crypto.randomUUID(), ...extra });
  await g(guessHost, "start");
  await g(guessHost, "advance");
  const guessAuthor = await getRoom(guessCode, guessHost.token);
  assert.equal(guessAuthor.self.role, "author");
  const chosen = guessAuthor.self.hand[0];
  const beforeReveal = await getRoom(guessCode, guessGuest.token);
  assert.equal(beforeReveal.players.every(p => p.card === null), true);
  assert.equal(beforeReveal.players.find(p => p.id === guessHost.room.self.id).role, "author");
  assert.equal(beforeReveal.players.find(p => p.id === guessGuest.room.self.id).role, null);
  assert.equal(beforeReveal.self.hand.includes(chosen), false);
  assert.equal(JSON.stringify(beforeReveal).includes("tokenHash"), false);
  await g(guessHost, "select", { target: "B", cardId: chosen });
  await g(guessHost, "advance");
  const hidden = await getRoom(guessCode, guessGuest.token);
  assert.equal(hidden.round.target, null);
  assert.equal(hidden.self.target, null);
  assert.equal(hidden.players.find(p => p.id === guessHost.room.self.id).card, chosen);
  assert.equal(JSON.stringify(hidden).includes("tokenHash"), false);
  await g(guessGuest, "vote", { value: "B" });
  await g(guessHost, "advance");
  const revealed = await getRoom(guessCode, guessGuest.token);
  assert.equal(revealed.round.phase, "results");
  assert.equal(revealed.round.target, "B");
  await g(guessHost, "score", { playerId: guessGuest.room.self.id, delta: 4 });
  assert.equal((await getRoom(guessCode, guessGuest.token)).players.find(p => p.id === guessGuest.room.self.id).score, 4);
  await assert.rejects(() => g(guessGuest, "scoreSet", { playerId: guessGuest.room.self.id, score: 99, expectedScore: 4 }), /房主/);
  const intruder = await enterRoom(guessCode, "旁听");
  assert.notEqual(intruder.room.self.id, guessHost.room.self.id);
  assert.equal((await getRoom(guessCode, guessHost.token)).self.id, guessHost.room.self.id);
  console.log("PASS 2-player guessing round, hidden target, manual score and seat takeover refusal");

  closeDatabase();
  const recovered = reopenInNewProcess(guessCode, guessHost.token);
  assert.equal(recovered.id, guessHost.room.self.id);
  assert.equal(recovered.players, 3);
  const guestRecovered = reopenInNewProcess(guessCode, guessGuest.token);
  assert.equal(guestRecovered.score, 4);
  const denied = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "-e", `
    const store = require(${JSON.stringify(storePath)});
    store.getRoom(${JSON.stringify(guessCode)}, "not-a-seat-token").then(() => process.exit(2)).catch(error => {
      if (!/凭证无效/.test(error.message)) { console.error(error.message); process.exit(1); }
      store.closeDatabase();
    });
  `], { env: { ...process.env, JUKEBOX_DB_PATH: dbPath }, encoding: "utf8" });
  assert.equal(denied.status, 0, denied.stderr);
  console.log("PASS room and manual score survive a new process; another client cannot take the seat");
  console.log("\n8 storage/concurrency scenarios passed (persistent SQLite, including process restart).");
} finally {
  closeDatabase();
  rmSync(temp, { recursive: true, force: true });
}
