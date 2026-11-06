import { getPersona } from "./personas";
import { BotError, DIMENSIONS, type AssetReading, type BotObservation, type CardEvaluation, type Language, type Persona } from "./types";

export type HandAssessmentInput = {
  roundId: string;
  language: Language;
  persona: Persona;
  music: AssetReading;
  hand: AssetReading[];
};

export type RankedCard = CardEvaluation & { score: number };
export type CardChoice = { cardId: string; alignment: number; forced: boolean };

export function recordOf(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BotError("INVALID_DATA", `${label} must be an object.`);
  return value as Record<string, unknown>;
}

export function requireOnlyKeys(value: Record<string, unknown>, keys: readonly string[], label: string) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new BotError("INVALID_MODEL_OUTPUT", `${label} contains an unsupported field.`);
}

export function textOf(value: unknown, label: string, max = 120): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new BotError("INVALID_DATA", `${label} must be nonempty text of at most ${max} characters.`);
  }
  return value;
}

export function unitScore(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new BotError("INVALID_MODEL_OUTPUT", `${label} must be a finite number from 0 to 1.`);
  }
  return value;
}

export function textsOf(value: unknown, label: string, maxItems: number, maxLength: number, minItems = 0): string[] {
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) throw new BotError("INVALID_DATA", `${label} has an invalid length.`);
  return value.map((item, index) => textOf(item, `${label}[${index}]`, maxLength));
}

/** Strip extra fields recursively. Input descriptions remain untrusted data, not instructions. */
export function cloneAssetReading(value: AssetReading, expectedKind?: AssetReading["kind"]): AssetReading {
  const v = recordOf(value, "Asset reading");
  if ((v.kind !== "card" && v.kind !== "music") || (expectedKind && v.kind !== expectedKind)) throw new BotError("INVALID_DATA", "Unexpected asset kind.");
  if (v.reviewStatus !== "unreviewed" && v.reviewStatus !== "reviewed" && v.reviewStatus !== "disputed") throw new BotError("INVALID_DATA", "Invalid asset review status.");
  return {
    id: textOf(v.id, "Asset ID"),
    kind: v.kind,
    revision: textOf(v.revision, "Asset revision"),
    facts: textsOf(v.facts, "Asset facts", 30, 1000),
    interpretations: textsOf(v.interpretations, "Asset interpretations", 30, 1000),
    reviewStatus: v.reviewStatus,
  };
}

export function languageOf(value: unknown): Language {
  if (value !== "en" && value !== "zh") throw new BotError("INVALID_DATA", "Unsupported language.");
  return value;
}

/** Neither identity nor assigned/selected card participates in this model input. */
export function projectHandAssessment(observation: BotObservation): HandAssessmentInput {
  const o = recordOf(observation, "Observation");
  const self = recordOf(o.self, "Self");
  if (!Array.isArray(o.hand) || o.hand.length < 1 || o.hand.length > 8) throw new BotError("INVALID_DATA", "A hand must contain 1 to 8 cards.");
  const hand = o.hand.map(card => cloneAssetReading(card as AssetReading, "card"));
  if (new Set(hand.map(card => card.id)).size !== hand.length) throw new BotError("INVALID_DATA", "A hand cannot contain duplicate card IDs.");
  const music = cloneAssetReading(o.music as AssetReading, "music");
  return {
    roundId: textOf(o.roundId, "Round ID"),
    language: languageOf(o.language),
    persona: getPersona(self.personaId),
    music,
    hand,
  };
}

/** Accept the model's array or its strict { evaluations } envelope. */
export function validateCardEvaluations(value: unknown, input: HandAssessmentInput): CardEvaluation[] {
  let raw = value;
  if (!Array.isArray(raw)) {
    const envelope = recordOf(raw, "Hand assessment");
    requireOnlyKeys(envelope, ["evaluations"], "Hand assessment");
    raw = envelope.evaluations;
  }
  if (!Array.isArray(raw) || raw.length !== input.hand.length) throw new BotError("INVALID_MODEL_OUTPUT", "Assess every card in the hand exactly once.");
  const allowedIds = new Set(input.hand.map(card => card.id));
  const seen = new Set<string>();
  return raw.map(item => {
    const v = recordOf(item, "Card evaluation");
    requireOnlyKeys(v, ["cardId", "alignment", "evidence"], "Card evaluation");
    const cardId = textOf(v.cardId, "Evaluated card ID");
    if (!allowedIds.has(cardId) || seen.has(cardId)) throw new BotError("INVALID_MODEL_OUTPUT", "Card evaluation contains a duplicate or unknown card.");
    seen.add(cardId);
    const a = recordOf(v.alignment, "Alignment");
    requireOnlyKeys(a, DIMENSIONS, "Alignment");
    return {
      cardId,
      alignment: {
        emotion: unitScore(a.emotion, "emotion"), tension: unitScore(a.tension, "tension"),
        motion: unitScore(a.motion, "motion"), energy: unitScore(a.energy, "energy"),
        texture: unitScore(a.texture, "texture"), space: unitScore(a.space, "space"),
        narrative: unitScore(a.narrative, "narrative"), structure: unitScore(a.structure, "structure"),
      },
      evidence: textsOf(v.evidence, "Card evidence", 6, 500, 1),
    };
  });
}

/** Ranking is deterministic for a recorded assessment; ties retain hand order. */
export function rankHand(input: HandAssessmentInput, evaluations: unknown): RankedCard[] {
  const validated = validateCardEvaluations(evaluations, input);
  const attention = recordOf(input.persona.attention, "Recorded attention weights");
  requireOnlyKeys(attention, DIMENSIONS, "Recorded attention weights");
  const total = DIMENSIONS.reduce((sum, dimension) => sum + unitScore(attention[dimension], dimension), 0);
  if (Math.abs(total - 1) > 1e-9) throw new BotError("INVALID_DATA", "Recorded attention weights must sum to one.");
  const byId = new Map(validated.map(evaluation => [evaluation.cardId, evaluation]));
  return input.hand.map(card => {
    const e = byId.get(card.id)!;
    return {
      cardId: e.cardId, alignment: e.alignment, evidence: e.evidence,
      score: DIMENSIONS.reduce((sum, dimension) => sum + Number(attention[dimension]) * e.alignment[dimension], 0),
    };
  }).sort((a, b) => b.score - a.score);
}

/** Use one recorded, identity-blind assessment for both roles. Never ask the model to choose a legal action. */
export function chooseCard(observation: BotObservation, evaluations: unknown): CardChoice {
  if (observation.phase !== "selecting") throw new BotError("INVALID_PHASE", "Cards can only be chosen during selection.");
  const input = projectHandAssessment(observation);
  const ranked = rankHand(input, evaluations);
  if (observation.self.role === "audience") return { cardId: ranked[0].cardId, alignment: ranked[0].score, forced: false };
  if (observation.self.role !== "improviser") throw new BotError("INVALID_DATA", "Unknown private role.");
  const assignedId = textOf(observation.assignedCardId, "Assigned card ID");
  const assigned = ranked.find(card => card.cardId === assignedId);
  if (!assigned) throw new BotError("INVALID_ASSIGNMENT", "The assigned card must be in the bot's hand.");
  return { cardId: assigned.cardId, alignment: assigned.score, forced: true };
}
