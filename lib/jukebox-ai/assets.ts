import catalog from "../catalog.json";
import { BotError, type AssetReading } from "./types";

export type AssetKind = AssetReading["kind"];
export type ReviewActor = { id: string; kind: "human" | "model" };
export type AssetMedia = {
  path: string;
  thumbnail?: string;
  width?: number;
  height?: number;
  title?: string;
  composer?: string;
  performer?: string;
  durationSeconds?: number;
  expectedSha256?: string;
  excerptNotes?: string;
};
export type AssetRecord = AssetReading & {
  catalogVersion: number;
  media: AssetMedia;
  descriptionSource: "missing" | "visual-observation" | "human-review" | "model-proposal";
  reviewNote: string;
  updatedBy: string | null;
  updatedAt: string | null;
};
export type AssetPatch = {
  expectedRevision: string;
  facts?: string[];
  interpretations?: string[];
  reviewStatus?: AssetReading["reviewStatus"];
  reviewNote?: string;
  /** A trusted human reviewer confirms these are observed details, not a feeling label. */
  confirmObservedFacts?: boolean;
};

const seedFacts: Record<string, string[]> = {
  "001": [
    "A woman is seated beside a window, with her hands resting in front of her.",
    "She is looking outward; the window opens onto a distant landscape.",
  ],
  "024": [
    "A figure with a walking staff and a bag stands in front of a large wooden door in a stone wall.",
  ],
};

/** No card emotion or musical qualities are inferred from filenames or track titles. */
export function createAssetRecords(): AssetRecord[] {
  const base = {
    revision: "0", catalogVersion: catalog.version,
    interpretations: [] as string[], reviewStatus: "unreviewed" as const,
    reviewNote: "", updatedBy: null, updatedAt: null,
  };
  const cards: AssetRecord[] = catalog.cards.map(card => ({
    ...base, id: card.id, kind: "card", facts: [...(seedFacts[card.id] ?? [])], interpretations: [],
    media: { path: card.image, thumbnail: card.thumbnail, width: card.width, height: card.height },
    descriptionSource: seedFacts[card.id] ? "visual-observation" : "missing",
    reviewNote: seedFacts[card.id]
      ? "Pending human review. The seed describes visible content only; emotion, moonlight and knocking are not established facts."
      : "Description pending review; do not invent content from the card ID.",
  }));
  const music: AssetRecord[] = catalog.groups.flatMap(group => group.tracks.map(track => ({
    ...base, id: track.id, kind: "music" as const, facts: [], interpretations: [],
    media: {
      path: track.path, title: track.title, composer: track.composer, performer: track.performer,
      durationSeconds: track.durationSeconds, expectedSha256: track.expectedSha256, excerptNotes: track.changes,
    },
    descriptionSource: "missing" as const,
    reviewNote: "Listen to the actual excerpt before adding audible facts or possible interpretations. The title is catalog metadata only.",
  })));
  return [...cards, ...music];
}

export function getAssetRecord(kind: AssetKind, id: string): AssetRecord | undefined {
  return createAssetRecords().find(record => record.kind === kind && record.id === id);
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function lines(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 24 || value.some(line => typeof line !== "string" || !line.trim() || line.length > 800)) {
    throw new BotError("INVALID_ASSET_PATCH", `${field} must contain at most 24 nonempty descriptions of at most 800 characters.`);
  }
  return [...new Set(value.map(line => (line as string).trim()))];
}

/** Strict patch validation. Caller supplies trusted actor identity, never a client-selected kind. */
export function applyAssetPatch(record: AssetRecord, input: unknown, actor: ReviewActor, at = new Date().toISOString()): AssetRecord {
  if (!plainObject(input)) throw new BotError("INVALID_ASSET_PATCH", "Expected an asset review object.");
  const allowed = new Set(["expectedRevision", "facts", "interpretations", "reviewStatus", "reviewNote", "confirmObservedFacts"]);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new BotError("INVALID_ASSET_PATCH", "Unknown asset review field.");
  if (typeof input.expectedRevision !== "string" || input.expectedRevision !== record.revision) {
    throw new BotError("ASSET_REVISION_CONFLICT", "This asset was changed. Read the current version before reviewing again.");
  }
  if (!/^\d+$/.test(record.revision) || !Number.isSafeInteger(Number(record.revision)) || Number(record.revision) >= Number.MAX_SAFE_INTEGER) {
    throw new BotError("INVALID_ASSET_REVISION", "Invalid asset revision.");
  }
  if (!actor || !["human", "model"].includes(actor.kind) || typeof actor.id !== "string" || !actor.id.trim() || actor.id.length > 160) {
    throw new BotError("INVALID_REVIEW_ACTOR", "A reviewer identity is required.");
  }
  if (!Number.isFinite(Date.parse(at))) throw new BotError("INVALID_ASSET_PATCH", "Invalid review timestamp.");
  if (input.confirmObservedFacts !== undefined && typeof input.confirmObservedFacts !== "boolean") {
    throw new BotError("INVALID_ASSET_PATCH", "confirmObservedFacts must be boolean.");
  }
  const next = structuredClone(record);
  const changesFacts = input.facts !== undefined;
  const changesInterpretations = input.interpretations !== undefined;
  if (changesFacts) {
    if (actor.kind === "human" && input.confirmObservedFacts !== true) {
      throw new BotError("FACT_REVIEW_REQUIRED", "Human fact edits require explicit confirmation; interpretations are stored separately.");
    }
    next.facts = lines(input.facts, "facts");
  }
  if (changesInterpretations) next.interpretations = lines(input.interpretations, "interpretations");
  if (input.reviewStatus !== undefined) {
    if (!["unreviewed", "reviewed", "disputed"].includes(String(input.reviewStatus))) {
      throw new BotError("INVALID_ASSET_PATCH", "Unknown review status.");
    }
    if (actor.kind !== "human" && input.reviewStatus !== "unreviewed") {
      throw new BotError("FACT_REVIEW_REQUIRED", "Model proposals cannot mark an asset as human-reviewed or disputed.");
    }
    if (input.reviewStatus === "reviewed" && input.confirmObservedFacts !== true) {
      throw new BotError("FACT_REVIEW_REQUIRED", "Approving a description requires explicit human confirmation of its observed facts.");
    }
    next.reviewStatus = input.reviewStatus as AssetReading["reviewStatus"];
  } else if (changesFacts || changesInterpretations) {
    next.reviewStatus = "unreviewed";
  }
  if (actor.kind === "model") next.reviewStatus = "unreviewed";
  if (input.reviewNote !== undefined) {
    if (typeof input.reviewNote !== "string" || input.reviewNote.length > 2000) throw new BotError("INVALID_ASSET_PATCH", "Review note is too long.");
    next.reviewNote = input.reviewNote.trim();
  }
  if (next.reviewStatus === "reviewed" && next.facts.length + next.interpretations.length === 0) {
    throw new BotError("EMPTY_ASSET_REVIEW", "An empty description remains pending review.");
  }
  if (changesFacts || changesInterpretations) next.descriptionSource = actor.kind === "human" ? "human-review" : "model-proposal";
  next.revision = String(Number(record.revision) + 1);
  next.updatedBy = actor.id;
  next.updatedAt = at;
  return next;
}

/** Safe semantic projection: titles, composers and source metadata are not hearing evidence. */
export function toAssetReading(record: AssetRecord): AssetReading {
  return {
    id: record.id, kind: record.kind, revision: record.revision,
    facts: [...record.facts], interpretations: [...record.interpretations], reviewStatus: record.reviewStatus,
  };
}

export function assetNeedsReview(record: AssetReading): boolean {
  return record.reviewStatus !== "reviewed" || record.facts.length + record.interpretations.length === 0;
}
