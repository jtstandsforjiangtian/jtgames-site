const base = process.argv[2];
const resumePath = process.argv[3] === "--resume" ? process.argv[4] : "";
if (!base) {
  console.error("用法: node scripts/verify-running.mjs http://127.0.0.1:3000 [--resume state.json]");
  process.exit(1);
}

async function api(path, data, token) {
  const response = await fetch(new URL(path, base), {
    method: data ? "POST" : "GET",
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${body.error || response.statusText}`);
  return body;
}

async function expectFail(path, data, token, pattern) {
  const response = await fetch(new URL(path, base), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data),
  });
  const body = await response.json();
  if (response.ok || !pattern.test(body.error || "")) throw new Error(`expected failure ${pattern}, got ${response.status} ${body.error}`);
}

if (resumePath) {
  const saved = JSON.parse(await (await import("node:fs/promises")).readFile(resumePath, "utf8"));
  const room = (await api(`/api/room?code=${saved.code}`, undefined, saved.token)).room;
  const score = room.players.find(player => player.id === saved.playerId).score;
  if (score !== saved.score) throw new Error(`score changed across restart: ${score} != ${saved.score}`);
  const denied = await fetch(new URL(`/api/room?code=${saved.code}`, base), { headers: { Authorization: "Bearer not-the-seat" } });
  if (denied.status !== 401) throw new Error(`unexpected status ${denied.status}`);
  console.log("PASS running server restored the room and manual score after restart");
  process.exit(0);
}

const health = await fetch(new URL("/api/health", base));
if (!health.ok) throw new Error("health check failed");
const home = await fetch(base);
if (!home.ok || !(await home.text()).includes("你听到了什么？")) throw new Error("homepage missing");

const catalog = (await import("../lib/catalog.json", { with: { type: "json" } })).default;
for (const card of catalog.cards) {
  const response = await fetch(new URL(card.image, base));
  if (!response.ok || !response.headers.get("content-type")?.includes("image/")) throw new Error(`missing ${card.image}`);
}
for (const track of catalog.groups.flatMap(group => group.tracks)) {
  const response = await fetch(new URL(track.path, base));
  if (!response.ok || !response.headers.get("content-type")?.includes("audio/")) throw new Error(`missing ${track.path}`);
}
console.log("PASS homepage, 65 card images and 30 audio files are served by this site");

const created = await api("/api/rooms", { name: "主持", settings: { mode: "identity", handSize: 5 } });
const code = created.room.code;
const seats = [created];
for (let i = 1; i < 5; i++) seats.push(await api(`/api/room?code=${code}`, { type: "join", name: `玩家${i}` }));
const act = (seat, type, extra = {}, requestId = crypto.randomUUID()) => api(`/api/room?code=${code}`, { type, requestId, ...extra }, seat.token);
await act(seats[0], "start");
await act(seats[0], "advance");
const views = await Promise.all(seats.map(seat => api(`/api/room?code=${code}`, undefined, seat.token)));
const author = seats[views.findIndex(view => view.room.self.role === "author")];
const ordinary = seats.find(seat => seat !== author && views[seats.indexOf(seat)].room.self.role === "listener");
const authorView = views[seats.indexOf(author)].room;
const ordinaryView = views[seats.indexOf(ordinary)].room;
if (ordinaryView.self.target !== null) throw new Error("listener saw the secret target");
if (JSON.stringify(ordinaryView).includes(authorView.self.hand[0])) throw new Error("listener saw the author hand");
await expectFail(`/api/room?code=${code}`, { type: "score", requestId: crypto.randomUUID(), playerId: ordinary.room.self.id, delta: 1 }, ordinary.token, /房主/);
console.log("PASS 5-player identity API hides hands and rejects guest scoring");

const guess = await api("/api/rooms", { name: "出题", settings: { mode: "guess" } });
const guest = await api(`/api/room?code=${guess.room.code}`, { type: "join", name: "猜测" });
const play = (seat, type, extra = {}) => api(`/api/room?code=${guess.room.code}`, { type, requestId: crypto.randomUUID(), ...extra }, seat.token);
await play(guess, "start");
await play(guess, "advance");
const authorHand = (await api(`/api/room?code=${guess.room.code}`, undefined, guess.token)).room.self.hand[0];
await play(guess, "select", { target: "A", cardId: authorHand });
await play(guess, "advance");
const hidden = (await api(`/api/room?code=${guess.room.code}`, undefined, guest.token)).room;
if (hidden.round.target !== null) throw new Error("guess target leaked");
await play(guest, "vote", { value: "A" });
await play(guess, "advance");
const requestId = "verify-score-once";
await Promise.all([
  api(`/api/room?code=${guess.room.code}`, { type: "score", requestId, playerId: guest.room.self.id, delta: 2 }, guess.token),
  api(`/api/room?code=${guess.room.code}`, { type: "score", requestId, playerId: guest.room.self.id, delta: 2 }, guess.token),
]);
const scored = (await api(`/api/room?code=${guess.room.code}`, undefined, guest.token)).room;
const guestScore = scored.players.find(player => player.id === guest.room.self.id).score;
if (guestScore !== 2) throw new Error(`duplicate score applied: ${guestScore}`);
await expectFail(`/api/room?code=${guess.room.code}`, { type: "scoreSet", requestId: crypto.randomUUID(), playerId: guest.room.self.id, score: 8, expectedScore: 0 }, guess.token, /刚刚被更新/);
console.log("PASS 2-player guessing round, duplicate score protection and stale score rejection");

const crowd = await api("/api/rooms", { name: "房主", settings: { mode: "guess" } });
await Promise.all(Array.from({ length: 7 }, (_, i) => api(`/api/room?code=${crowd.room.code}`, { type: "join", name: `同行${i}` })));
const full = (await api(`/api/room?code=${crowd.room.code}`, undefined, crowd.token)).room;
if (full.players.length !== 8) throw new Error(`expected 8 players, got ${full.players.length}`);
console.log("PASS 8 concurrent joins through the running server");

const state = { code: guess.room.code, token: guess.token, playerId: guest.room.self.id, score: guestScore };
if (process.argv[3] === "--save") await (await import("node:fs/promises")).writeFile(process.argv[4], JSON.stringify(state));
console.log("PASS running API verification");
