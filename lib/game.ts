import { cards, getGroup, labels, type ClipLabel } from "./catalog-utils";

export type Mode = "guess" | "identity";
export type Role = "author" | "spy" | "listener";
export type Phase = "listening" | "selecting" | "discussion" | "voting" | "results";
export type Settings = { mode: Mode; groupKey: string; handSize: number; explainFirst: boolean };
export type Player = { id: string; name: string; tokenHash: string; hand: string[]; score: number; lastSeen: number; readyFor: string };
export type Ballot = { id: string; kind: "music" | "player"; prompt: string; voters: string[]; allowSelf: boolean; abstain: boolean; votes: Record<string, string>; revealed: boolean; isDefault: boolean };
export type Round = { id: string; number: number; settings: Settings; phase: Phase; roster: string[]; roles: Record<string, Role>; authorId: string; target: ClipLabel | null; selections: Record<string, string>; cardsRevealed: boolean; targetRevealed: boolean; rolesRevealed: boolean; ballot: Ballot | null; previousBallots: Ballot[] };
export type Playback = { id: string; groupKey: string; sequence: ClipLabel[]; startAt: number; offset: number; paused: boolean };
export type Room = { code: string; hostId: string; settings: Settings; players: Player[]; round: Round | null; deck: string[]; discard: string[]; roundCounter: number; lastAuthorId: string | null; audio: Playback | null; log: { at: number; text: string }[]; requests: string[]; createdAt: number; updatedAt: number; revision: number };
export type Action = { type: string; requestId?: string; [key: string]: unknown };
export class GameError extends Error { constructor(message: string, public status = 400) { super(message); } }
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new GameError(message); }
export function shuffled<T>(input: T[]): T[] {
  const out = [...input];
  for (let i = out.length - 1; i > 0; i--) {
    const n = new Uint32Array(1); crypto.getRandomValues(n);
    const j = n[0] % (i + 1); [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
export function nameOf(value: unknown) {
  check(typeof value === "string", "请输入昵称。");
  const name = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  check(name.length >= 1 && name.length <= 20, "昵称应为 1–20 个字符。"); return name;
}
export function settingsOf(value: unknown, base?: Settings): Settings {
  const v = value && typeof value === "object" ? value as Partial<Settings> : {};
  const s = { mode: "guess", groupKey: "G01", handSize: 5, explainFirst: false, ...base, ...v };
  check(s.mode === "guess" || s.mode === "identity", "请选择游戏模式。");
  check(typeof s.groupKey === "string" && getGroup(s.groupKey), "曲组不存在。");
  check(Number.isInteger(s.handSize) && s.handSize >= 3 && s.handSize <= 8, "手牌数应为 3–8。");
  return { mode: s.mode, groupKey: s.groupKey, handSize: s.handSize, explainFirst: !!s.explainFirst };
}
function log(room: Room, text: string, now: number) { room.log.push({ at: now, text }); room.log = room.log.slice(-50); }
function deal(room: Room) {
  const size = room.round?.settings.handSize ?? room.settings.handSize;
  for (const p of room.players) {
    while (p.hand.length > size) room.discard.push(p.hand.pop()!);
    while (p.hand.length < size) {
      if (!room.deck.length) { room.deck = shuffled(room.discard); room.discard = []; }
      const card = room.deck.pop(); if (!card) break; p.hand.push(card);
    }
  }
}
export function createRoom(code: string, player: Player, settings: Settings, now: number): Room {
  return { code, hostId: player.id, settings, players: [player], round: null, deck: shuffled(cards.map(c => c.id)), discard: [], roundCounter: 0, lastAuthorId: null, audio: null, log: [{ at: now, text: "房间已建立。邀请朋友，一起入席。" }], requests: [], createdAt: now, updatedAt: now, revision: 0 };
}
export function joinRoom(room: Room, player: Player, now: number) {
  check(room.players.length < 8, "房间已满，最多 8 人。");
  check(!room.players.some(p => p.name === player.name), "这个昵称已有人使用。若是你，请使用原浏览器恢复座位。");
  room.players.push(player); log(room, `${player.name} 入席。${room.round && room.round.phase !== "results" ? "下一轮开始参与。" : ""}`, now);
}
function defaultBallot(r: Round): Ballot {
  return { id: crypto.randomUUID(), kind: r.settings.mode === "guess" ? "music" : "player", prompt: r.settings.mode === "guess" ? "这张画对应哪段音乐？" : "秘密指认", voters: r.roster.filter(id => r.settings.mode === "guess" ? id !== r.authorId : r.roles[id] !== "spy"), allowSelf: false, abstain: true, votes: {}, revealed: false, isDefault: true };
}
function openDefault(r: Round) { r.ballot = defaultBallot(r); r.phase = "voting"; }
function finish(r: Round) { r.phase = "results"; r.cardsRevealed = true; r.targetRevealed = true; r.rolesRevealed = true; if (r.ballot) r.ballot.revealed = true; }
function start(room: Room, now: number, force: boolean) {
  const s = room.settings;
  check(room.players.length >= (s.mode === "guess" ? 2 : 3), s.mode === "guess" ? "猜音乐至少需要 2 人。" : "隐藏身份至少需要 3 人；建议 4–8 人。");
  check(!room.round || room.round.phase === "results" || force, "当前轮尚未结束。请先结束本轮，或确认强制重开。");
  if (room.round) for (const p of room.players) {
    const used = room.round.selections[p.id];
    if (used && p.hand.includes(used)) { p.hand = p.hand.filter(c => c !== used); room.discard.push(used); }
  }
  const roster = room.players.map(p => p.id);
  const randomized = shuffled(roster);
  const nextIndex = (roster.indexOf(room.lastAuthorId ?? "") + 1) % roster.length;
  const authorId = s.mode === "guess" ? roster[nextIndex] : randomized[0];
  const roles = Object.fromEntries(roster.map(id => [id, "listener"])) as Record<string, Role>;
  roles[authorId] = "author"; if (s.mode === "identity") roles[randomized[1]] = "spy";
  room.roundCounter++;
  room.round = { id: crypto.randomUUID(), number: room.roundCounter, settings: { ...s }, phase: "listening", roster, roles, authorId, target: null, selections: {}, cardsRevealed: false, targetRevealed: false, rolesRevealed: false, ballot: null, previousBallots: [] };
  if (s.mode === "guess") room.lastAuthorId = authorId;
  room.audio = null; deal(room); log(room, `第 ${room.roundCounter} 轮开始 · ${s.mode === "guess" ? "猜音乐" : "隐藏身份"} · ${getGroup(s.groupKey)!.label}`, now);
}
const needsCard = (r: Round, id: string) => r.settings.mode === "identity" || id === r.authorId;
export function applyAction(room: Room, playerId: string, a: Action, now = Date.now()) {
  const p = room.players.find(x => x.id === playerId); check(p, "座位已移除，请重新加入。");
  if (a.requestId && room.requests.includes(a.requestId)) return;
  const host = () => check(room.hostId === playerId, "只有房主可以进行这个操作。");
  const round = () => { check(room.round, "请先开始一轮。"); return room.round; };
  if (a.type === "heartbeat") { p.lastSeen = now; return; }
  if (a.type === "ready") { check(typeof a.groupKey === "string" && getGroup(a.groupKey), "曲组不存在。"); p.readyFor = a.ready === true ? a.groupKey : ""; }
  else if (a.type === "settings") { host(); room.settings = settingsOf(a.settings, room.settings); log(room, "房间设置已更新，将用于下一轮。", now); }
  else if (a.type === "start") { host(); start(room, now, a.force === true); }
  else if (a.type === "select") {
    const r = round(); check(r.phase === "selecting", "现在不是选牌阶段。"); check(r.roster.includes(p.id) && needsCard(r, p.id), "你本轮无需出牌。");
    check(typeof a.cardId === "string" && p.hand.includes(a.cardId), "请选择自己手中的牌。");
    if (r.roles[p.id] === "spy") check(r.target, "请等待秘密信息，然后选牌。");
    if (p.id === r.authorId) {
      check(labels.includes(a.target as ClipLabel), "请选择目标音乐 A、B 或 C。");
      check(!r.target || r.target === a.target || r.settings.mode === "guess", "目标已发送给间谍，不能再更换；可以更换插画。");
      r.target = a.target as ClipLabel;
    }
    r.selections[p.id] = a.cardId;
  }
  else if (a.type === "advance") {
    host(); const r = round(); const force = a.force === true;
    if (r.phase === "listening") r.phase = "selecting";
    else if (r.phase === "selecting") {
      check(r.target && r.selections[r.authorId], "作者需要先选定目标音乐与插画。");
      check(force || r.roster.filter(id => needsCard(r, id)).every(id => r.selections[id]), "还有人未选牌。可等待，或在房主管理中强制推进。");
      r.cardsRevealed = true;
      if (r.settings.mode === "identity") { r.targetRevealed = true; r.phase = "discussion"; }
      else if (r.settings.explainFirst) r.phase = "discussion";
      else openDefault(r);
    } else if (r.phase === "discussion") openDefault(r);
    else if (r.phase === "voting") {
      check(r.ballot, "请先发起投票。");
      check(force || r.ballot.voters.every(id => r.ballot!.votes[id] !== undefined), "还有人未投票。可等待，或强制结算。"); finish(r);
    } else throw new GameError("本轮已结束，请开始下一轮。");
    room.audio = null; log(room, `流程推进至${({ listening: "聆听", selecting: "选牌", discussion: "解释与讨论", voting: "秘密投票", results: "揭晓" })[r.phase]}。`, now);
  }
  else if (a.type === "vote") {
    const r = round(); const b = r.ballot; check(b && !b.revealed && r.phase === "voting", "当前没有开放的投票。"); check(b.voters.includes(p.id), "本次投票无需你参与。");
    const value = String(a.value);
    check(value !== "abstain" || b.abstain, "这次投票不允许弃权。");
    if (value !== "abstain") {
      if (b.kind === "music") check(labels.includes(value as ClipLabel), "投票选项无效。");
      else { check(r.roster.includes(value), "请选择本轮的一位玩家。"); check(b.allowSelf || value !== p.id, "不能投给自己。"); }
    }
    b.votes[p.id] = value;
  }
  else if (a.type === "ballot") {
    host(); const r = round(); check(r.cardsRevealed, "请先亮出插画，再发起投票。");
    check(!r.ballot || r.ballot.revealed, "请先结束当前投票。");
    check(a.kind === "music" || a.kind === "player", "投票类型无效。");
    const roles = Array.isArray(a.roles) ? a.roles.filter(x => ["author", "spy", "listener"].includes(String(x))) : [];
    const voters = r.roster.filter(id => roles.includes(r.roles[id])); check(voters.length, "至少选择一种参与投票的身份。");
    if (r.ballot) r.previousBallots = [...r.previousBallots, r.ballot].slice(-5);
    r.ballot = { id: crypto.randomUUID(), kind: a.kind, prompt: String(a.prompt || "自由投票").slice(0, 80), voters, allowSelf: a.allowSelf === true, abstain: a.abstain !== false, votes: {}, revealed: false, isDefault: false }; r.phase = "voting";
    log(room, "房主发起了自由投票。", now);
  }
  else if (a.type === "closeBallot") { host(); const r = round(); check(r.ballot, "当前没有投票。"); r.ballot.revealed = true; r.phase = r.rolesRevealed ? "results" : "discussion"; log(room, "本次投票已公开；身份与答案保持当前公开状态。", now); }
  else if (a.type === "reopen") {
    host(); const r = round(); check(!r.cardsRevealed, "插画已公开，无法撤回信息；请结束本轮或重开。"); r.phase = "selecting"; room.audio = null;
    log(room, "重新开放选牌。已发出的秘密目标保持不变。", now);
  }
  else if (a.type === "end") { host(); finish(round()); room.audio = null; log(room, "房主结束本轮，公开现有答案与身份。", now); }
  else if (a.type === "redeal") {
    host(); check(!room.round || room.round.phase === "results", "重新发牌请在两轮之间进行。");
    room.round = null; room.audio = null; room.deck = shuffled(cards.map(c => c.id)); room.discard = []; room.players.forEach(x => { x.hand = []; }); deal(room); log(room, "全部插画重新洗牌发放。", now);
  }
  else if (a.type === "score") {
    host(); const target = room.players.find(x => x.id === a.playerId); check(target, "玩家不存在。");
    check(typeof a.delta === "number" && Number.isInteger(a.delta) && Math.abs(a.delta) <= 100, "单次积分调整须为 -100 到 100 的整数。");
    target.score += a.delta; log(room, `${target.name} ${a.delta >= 0 ? "+" : ""}${a.delta} 分${a.note ? ` · ${String(a.note).slice(0, 100)}` : ""}`, now);
  }
  else if (a.type === "scoreSet") {
    host(); const target = room.players.find(x => x.id === a.playerId); check(target, "玩家不存在。");
    check(typeof a.score === "number" && Number.isInteger(a.score) && Math.abs(a.score) <= 9999, "总分须为 -9999 到 9999 的整数。");
    check(typeof a.expectedScore === "number" && Number.isInteger(a.expectedScore), "请重新读取当前积分后再保存。");
    check(target.score === a.expectedScore, "积分刚刚被更新，请重新读取当前分数后再保存。");
    const before = target.score; target.score = a.score;
    if (before !== target.score) log(room, `${target.name}：${before} → ${target.score} 分`, now);
  }
  else if (a.type === "transfer") { host(); check(room.players.some(x => x.id === a.playerId), "玩家不存在。"); room.hostId = String(a.playerId); log(room, "房主已移交。", now); }
  else if (a.type === "claimHost") {
    const h = room.players.find(x => x.id === room.hostId); check(!h || now - h.lastSeen > 90000, "房主仍在线；离线 90 秒后可接管。"); room.hostId = p.id; log(room, `${p.name} 接管了房主。`, now);
  }
  else if (a.type === "remove") {
    host(); check(!room.round || room.round.phase === "results", "请先结束本轮，再移除座位。"); check(a.playerId !== room.hostId, "请先移交房主再移除自己。");
    const target = room.players.find(x => x.id === a.playerId); check(target, "玩家不存在。");
    room.discard.push(...target.hand); room.players = room.players.filter(x => x.id !== target.id); log(room, `${target.name} 的座位已移除。`, now);
  }
  else if (a.type === "audio") {
    host(); const groupKey = room.round?.settings.groupKey ?? room.settings.groupKey;
    if (a.command === "stop") room.audio = null;
    else if (a.command === "pause") { check(room.audio, "当前没有播放。"); if (!room.audio.paused) { room.audio.offset = Math.max(0, now - room.audio.startAt + room.audio.offset); room.audio.paused = true; } }
    else if (a.command === "resume") { check(room.audio, "请先选择片段。"); room.audio.startAt = now + 3000; room.audio.paused = false; room.audio.id = crypto.randomUUID(); }
    else {
      const sequence = a.clip === "all" ? labels : labels.includes(a.clip as ClipLabel) ? [a.clip as ClipLabel] : [];
      check(sequence.length, "请选择片段。"); room.audio = { id: crypto.randomUUID(), groupKey, sequence, startAt: now + 3000, offset: 0, paused: false };
    }
  }
  else throw new GameError("不支持的操作。");
  p.lastSeen = now;
  if (a.requestId) room.requests = [...room.requests, a.requestId].slice(-100);
}
export function viewRoom(room: Room, playerId: string, now = Date.now()) {
  const self = room.players.find(p => p.id === playerId); check(self, "座位不存在。");
  const r = room.round;
  const ballotView = (b: Ballot) => ({ id: b.id, kind: b.kind, prompt: b.isDefault && r?.settings.mode === "identity" ? (r.roles[playerId] === "author" ? "谁提前知道了目标音乐？找出间谍。" : "谁是真正选择了这段音乐的作者？") : b.prompt, allowSelf: b.allowSelf, abstain: b.abstain, eligible: b.voters.includes(playerId), total: b.voters.length, submitted: Object.keys(b.votes).length, ownVote: b.votes[playerId] ?? null, revealed: b.revealed, tally: b.revealed ? Object.values(b.votes).reduce<Record<string, number>>((counts, value) => { counts[value] = (counts[value] || 0) + 1; return counts; }, {}) : {}, results: b.revealed && (r?.settings.mode !== "identity" || r.rolesRevealed) ? b.votes : null });
  return {
    code: room.code, hostId: room.hostId, settings: room.settings, revision: room.revision, serverNow: now,
    players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score, online: now - p.lastSeen < 45000, canClaimHost: p.id === room.hostId && now - p.lastSeen > 90000, readyFor: p.readyFor, handCount: p.hand.length,
      card: r?.cardsRevealed ? r.selections[p.id] ?? null : null,
      role: r?.rolesRevealed ? r.roles[p.id] ?? null : (r?.settings.mode === "guess" && p.id === r.authorId ? "author" as Role : null),
    })),
    self: { id: self.id, hand: self.hand, role: r?.roles[playerId] ?? null, active: !!r?.roster.includes(playerId), card: r?.selections[playerId] ?? null,
      target: r && (r.authorId === playerId || r.roles[playerId] === "spy" || r.targetRevealed) ? r.target : null,
      needsCard: !!r && r.roster.includes(playerId) && needsCard(r, playerId),
    },
    round: r ? { id: r.id, number: r.number, settings: r.settings, phase: r.phase, cardsRevealed: r.cardsRevealed, targetRevealed: r.targetRevealed, rolesRevealed: r.rolesRevealed, target: r.targetRevealed ? r.target : null, authorId: r.settings.mode === "guess" || r.rolesRevealed ? r.authorId : null, selectedCount: Object.keys(r.selections).length, selectionTotal: r.roster.filter(id => needsCard(r, id)).length, roster: r.roster, ballot: r.ballot ? ballotView(r.ballot) : null, previousBallots: r.previousBallots.map(ballotView) } : null,
    audio: room.audio, log: room.log,
  };
}
export type RoomView = ReturnType<typeof viewRoom>;
