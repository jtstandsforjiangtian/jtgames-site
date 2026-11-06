import { getPersona } from "./personas";
import { cloneAssetReading, languageOf, recordOf, requireOnlyKeys, textOf, textsOf, unitScore } from "./perception";
import { BotError, type AssetReading, type BotObservation, type CandidateJudgment, type Persona, type PublicParticipant, type PublicSnapshot, type PublicUtterance, type RankedJudgment } from "./types";

export type JudgmentInput = PublicSnapshot & {
  phase: "discussion" | "voting";
  self: { id: string; personaId: Persona["id"]; selectedCardId?: string };
  persona: Persona;
};

/** The caller supplies only active public participants. No room/seat credentials cross this boundary. */
export function projectJudgment(observation: BotObservation): JudgmentInput {
  const o = recordOf(observation, "Observation");
  if (o.phase !== "discussion" && o.phase !== "voting") throw new BotError("INVALID_PHASE", "Public judgments require revealed cards and discussion or voting.");
  const privateSelf = recordOf(o.self, "Self");
  const selfId = textOf(privateSelf.id, "Self ID");
  const persona = getPersona(privateSelf.personaId);
  if (!Array.isArray(o.players) || o.players.length < 2 || o.players.length > 8) throw new BotError("INVALID_DATA", "Expected 2 to 8 public participants.");
  const players: PublicParticipant[] = o.players.map(item => {
    const v = recordOf(item, "Public participant");
    const player: PublicParticipant = { id: textOf(v.id, "Player ID"), name: textOf(v.name, "Player name", 80) };
    if (v.personaId !== undefined) player.personaId = getPersona(v.personaId).id;
    if (v.cardId !== undefined) player.cardId = textOf(v.cardId, "Public card ID");
    return player;
  });
  const playerIds = new Set(players.map(player => player.id));
  if (playerIds.size !== players.length || !playerIds.has(selfId)) throw new BotError("INVALID_DATA", "Public participants must be unique and include the bot.");
  const visibleCardIds = new Set(players.flatMap(player => player.cardId ? [player.cardId] : []));
  if (!Array.isArray(o.revealedCards)) throw new BotError("INVALID_DATA", "Missing revealed cards.");
  const revealedCards: AssetReading[] = [];
  for (const item of o.revealedCards) {
    const v = recordOf(item, "Revealed card");
    if (!visibleCardIds.has(String(v.id))) continue;
    const card = cloneAssetReading(v as unknown as AssetReading, "card");
    if (revealedCards.some(existing => existing.id === card.id)) throw new BotError("INVALID_DATA", "Duplicate public card reading.");
    revealedCards.push(card);
  }
  if (revealedCards.length !== visibleCardIds.size) throw new BotError("INVALID_DATA", "Every publicly played card requires a reading.");
  if (!Array.isArray(o.transcript) || o.transcript.length > 500) throw new BotError("INVALID_DATA", "Invalid public transcript.");
  const transcript: PublicUtterance[] = o.transcript.map(item => {
    const v = recordOf(item, "Public utterance");
    const utterance: PublicUtterance = {
      id: textOf(v.id, "Message ID"), playerId: textOf(v.playerId, "Speaker ID"), text: textOf(v.text, "Public message", 4000),
    };
    if (!playerIds.has(utterance.playerId)) throw new BotError("INVALID_DATA", "Message speaker is not a public participant.");
    if (v.replyToPlayerId !== undefined) {
      utterance.replyToPlayerId = textOf(v.replyToPlayerId, "Reply target");
      if (!playerIds.has(utterance.replyToPlayerId)) throw new BotError("INVALID_DATA", "Reply target is not a public participant.");
    }
    return utterance;
  });
  const music = cloneAssetReading(o.music as AssetReading, "music");
  if (new Set(transcript.map(message => message.id)).size !== transcript.length) throw new BotError("INVALID_DATA", "Public message IDs must be unique.");
  const self: JudgmentInput["self"] = { id: selfId, personaId: persona.id };
  const ownPublicCard = players.find(player => player.id === selfId)?.cardId;
  if (ownPublicCard) self.selectedCardId = ownPublicCard;
  return {
    roundId: textOf(o.roundId, "Round ID"), phase: o.phase, language: languageOf(o.language),
    music, players, revealedCards, transcript, self, persona,
  };
}

export function publicEvidenceIds(input: JudgmentInput): string[] {
  const cardIds = new Set(input.players.flatMap(player => player.cardId ? [player.cardId] : []));
  return [`music:${input.music.id}`, ...input.revealedCards.filter(card => cardIds.has(card.id)).map(card => `card:${card.id}`), ...input.transcript.map(message => `message:${message.id}`)];
}

/** Require one score per other participant, and references only to what was publicly available. */
export function validateCandidateJudgments(value: unknown, input: JudgmentInput): CandidateJudgment[] {
  let raw = value;
  if (!Array.isArray(raw)) {
    const envelope = recordOf(raw, "Judgments");
    requireOnlyKeys(envelope, ["judgments"], "Judgments");
    raw = envelope.judgments;
  }
  const candidates = input.players.filter(player => player.id !== input.self.id);
  if (!Array.isArray(raw) || raw.length !== candidates.length) throw new BotError("INVALID_MODEL_OUTPUT", "Judge every other public participant exactly once.");
  const allowedPlayers = new Map(candidates.map(player => [player.id, player]));
  const allowedEvidence = new Set(publicEvidenceIds(input));
  const seen = new Set<string>();
  return raw.map(item => {
    const v = recordOf(item, "Candidate judgment");
    requireOnlyKeys(v, ["playerId", "selfMismatch", "statementConcern", "habitMismatch", "evidenceIds", "summary"], "Candidate judgment");
    const playerId = textOf(v.playerId, "Candidate ID");
    const player = allowedPlayers.get(playerId);
    if (!player || seen.has(playerId)) throw new BotError("INVALID_MODEL_OUTPUT", "Unknown, self or duplicate voting candidate.");
    seen.add(playerId);
    let habitMismatch: number | null = null;
    if (player.personaId) habitMismatch = unitScore(v.habitMismatch, "Habit mismatch");
    else if (v.habitMismatch !== null) throw new BotError("INVALID_MODEL_OUTPUT", "A participant without a known persona must have null habit mismatch.");
    const evidenceIds = textsOf(v.evidenceIds, "Evidence IDs", 12, 140, 1);
    if (new Set(evidenceIds).size !== evidenceIds.length || evidenceIds.some(id => !allowedEvidence.has(id))) {
      throw new BotError("INVALID_MODEL_OUTPUT", "Judgment references duplicate or non-public evidence.");
    }
    return {
      playerId,
      selfMismatch: unitScore(v.selfMismatch, "Self mismatch"),
      statementConcern: unitScore(v.statementConcern, "Statement concern"),
      habitMismatch, evidenceIds,
      summary: textOf(v.summary, "Judgment summary", 500),
    };
  });
}

export function rankJudgments(input: JudgmentInput, value: unknown): RankedJudgment[] {
  const judgments = validateCandidateJudgments(value, input);
  if (input.persona.id !== input.self.personaId) throw new BotError("INVALID_DATA", "Judging configuration must belong to the observing character.");
  const recordedWeights = recordOf(input.persona.judging, "Recorded judging weights");
  requireOnlyKeys(recordedWeights, ["self", "statement", "habit"], "Recorded judging weights");
  const originalWeights = {
    self: unitScore(recordedWeights.self, "Self weight"),
    statement: unitScore(recordedWeights.statement, "Statement weight"),
    habit: unitScore(recordedWeights.habit, "Habit weight"),
  };
  if (Math.abs(originalWeights.self + originalWeights.statement + originalWeights.habit - 1) > 1e-9 || originalWeights.self + originalWeights.statement === 0) {
    throw new BotError("INVALID_DATA", "Recorded judging weights must sum to one and support unknown habits.");
  }
  const byId = new Map(judgments.map(judgment => [judgment.playerId, judgment]));
  return input.players.filter(player => player.id !== input.self.id).map(player => {
    const j = byId.get(player.id)!;
    const total = originalWeights.self + originalWeights.statement + (j.habitMismatch === null ? 0 : originalWeights.habit);
    const weights = {
      self: originalWeights.self / total,
      statement: originalWeights.statement / total,
      habit: j.habitMismatch === null ? 0 : originalWeights.habit / total,
    };
    return {
      playerId: j.playerId, selfMismatch: j.selfMismatch, statementConcern: j.statementConcern,
      habitMismatch: j.habitMismatch, evidenceIds: j.evidenceIds, summary: j.summary,
      score: weights.self * j.selfMismatch + weights.statement * j.statementConcern + weights.habit * (j.habitMismatch ?? 0),
      weights,
    };
  }).sort((a, b) => b.score - a.score);
}

/** Highest concern wins; an exact tie follows the public seat order, never hidden identities. */
export function chooseVote(input: JudgmentInput, value: unknown): RankedJudgment {
  if (input.phase !== "voting") throw new BotError("INVALID_PHASE", "Votes may only be selected in the voting phase.");
  return rankJudgments(input, value)[0];
}
