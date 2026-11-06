/** Shared, engine-independent contracts. No complete room or seat credentials belong here. */
export const DIMENSIONS = ["emotion", "tension", "motion", "energy", "texture", "space", "narrative", "structure"] as const;
export type Dimension = typeof DIMENSIONS[number];
export type PersonaId = "beethoven" | "debussy" | "clara" | "bach" | "mozart";
export type Language = "en" | "zh";
export type JudgingWeights = { self: number; statement: number; habit: number };
export type Persona = {
  id: PersonaId;
  name: { en: string; zh: string };
  attention: Record<Dimension, number>;
  judging: JudgingWeights;
  perspective: string;
  conversation: string;
};
export type AssetReading = {
  id: string;
  kind: "card" | "music";
  revision: string;
  facts: string[];
  interpretations: string[];
  reviewStatus: "unreviewed" | "reviewed" | "disputed";
};
export type PublicParticipant = { id: string; name: string; personaId?: PersonaId; cardId?: string };
export type PublicUtterance = { id: string; playerId: string; text: string; replyToPlayerId?: string };
export type PublicSnapshot = {
  roundId: string;
  phase: "selecting" | "discussion" | "voting";
  language: Language;
  music: AssetReading;
  players: PublicParticipant[];
  revealedCards: AssetReading[];
  transcript: PublicUtterance[];
};
export type BotObservation = PublicSnapshot & {
  self: { id: string; personaId: PersonaId; role: "audience" | "improviser" };
  hand: AssetReading[];
  assignedCardId?: string;
  selectedCardId?: string;
  selectionMemory?: SelectedCardMemory;
};
export type CardEvaluation = {
  cardId: string;
  alignment: Record<Dimension, number>;
  evidence: string[];
};
export type SelectedCardMemory = {
  botId: string;
  roundId: string;
  cardId: string;
  cardRevision: string;
  musicId: string;
  musicRevision: string;
  personaVersion: string;
  evaluation: CardEvaluation;
};
export type CandidateJudgment = {
  playerId: string;
  selfMismatch: number;
  statementConcern: number;
  habitMismatch: number | null;
  evidenceIds: string[];
  summary: string;
};
export type RankedJudgment = CandidateJudgment & { score: number; weights: JudgingWeights };
export type DialogueReply = { text: string; addressedPlayerId: string | null; evidenceIds: string[] };
export type ModelMessage = { role: "system" | "user" | "assistant"; content: string };
export type JsonModelRequest = { task: string; messages: ModelMessage[]; schema: Record<string, unknown> };
export type ModelResult = { value: unknown; model: string; elapsedMs: number; requestId?: string; usage?: { inputTokens: number; outputTokens: number } };
export interface JsonModel { generate(request: JsonModelRequest, signal?: AbortSignal): Promise<ModelResult> }
export type AuditEvent = {
  version: 1;
  id: string;
  at: string;
  roundId: string;
  botId: string;
  task: "assess-hand" | "speak" | "judge";
  personaVersion: string;
  promptVersion: string;
  model: string;
  request: JsonModelRequest;
  result: unknown;
  elapsedMs: number;
  requestId?: string;
};
export class BotError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "BotError"; }
}
