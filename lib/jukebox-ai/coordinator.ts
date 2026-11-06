import { BotError, type AuditEvent, type BotObservation, type JsonModel, type SelectedCardMemory } from "./types";
import { PERSONA_VERSION } from "./personas";
import { chooseCard, projectHandAssessment, validateCardEvaluations } from "./perception";
import { chooseVote, projectJudgment, rankJudgments, validateCandidateJudgments } from "./judgment";
import { dialogueRequest, handRequest, judgmentRequest, PROMPT_VERSION, unwrapModelObject, validateReply } from "./prompts";

export type BotTask = AuditEvent["task"];
export type BotAction =
  | { type: "select"; cardId: string }
  | { type: "speak"; text: string; addressedPlayerId: string | null; evidenceIds: string[] }
  | { type: "vote"; playerId: string };
export type BotProposal = { action: BotAction; audit: AuditEvent; selectionMemory?: SelectedCardMemory };
export type BotTaskRequest = { roomCode: string; botId: string; task: BotTask; addressedPlayerId?: string };
export type TaskLease = { id: string; roundId: string; generation: string; expiresAt: number; observation: BotObservation };

/** Implement on the authoritative server. Never expose this adapter as an arbitrary-seat HTTP API. */
export interface BotRoomAdapter {
  /** Atomically claim the task, or return null if completed/in flight/not eligible. */
  claim(request: BotTaskRequest): Promise<TaskLease | null>;
  /** In one transaction: verify lease/generation, recheck legal action, apply it, and persist audit. */
  commit(lease: TaskLease, proposal: BotProposal): Promise<boolean>;
  /** Release only this lease, without changing a replacement job or a committed action. */
  release(lease: TaskLease, reason: string): Promise<void>;
}

export async function generateBotProposal(
  observation: BotObservation,
  task: BotTask,
  model: JsonModel,
  options: { addressedPlayerId?: string; signal?: AbortSignal } = {},
): Promise<BotProposal> {
  // An in-memory room may change while the provider is running; preserve exactly what this task saw.
  observation = structuredClone(observation);
  const expectedPhase = { "assess-hand": "selecting", speak: "discussion", judge: "voting" }[task];
  if (observation.phase !== expectedPhase) throw new BotError("wrong_phase", "The bot task does not match the current phase.");
  const request = task === "assess-hand" ? handRequest(observation) : task === "judge" ? judgmentRequest(observation) : dialogueRequest(observation, options.addressedPlayerId);
  const result = await model.generate(request, options.signal);
  options.signal?.throwIfAborted();
  let action: BotAction;
  let computed: unknown;
  let selectionMemory: SelectedCardMemory | undefined;
  if (task === "assess-hand") {
    const evaluations = validateCardEvaluations(unwrapModelObject(result.value, "evaluations"), projectHandAssessment(observation));
    const choice = chooseCard(observation, evaluations);
    action = { type: "select", cardId: choice.cardId };
    selectionMemory = {
      botId: observation.self.id, roundId: observation.roundId, cardId: choice.cardId,
      cardRevision: observation.hand.find(card => card.id === choice.cardId)!.revision,
      musicId: observation.music.id, musicRevision: observation.music.revision, personaVersion: PERSONA_VERSION,
      evaluation: evaluations.find(evaluation => evaluation.cardId === choice.cardId)!,
    };
    computed = { evaluations, choice, selectionMemory };
  } else if (task === "judge") {
    const view = projectJudgment(observation);
    const judgments = validateCandidateJudgments(unwrapModelObject(result.value, "judgments"), view);
    const ranking = rankJudgments(view, judgments);
    const choice = chooseVote(view, judgments);
    action = { type: "vote", playerId: choice.playerId };
    computed = { judgments, ranking, choice };
  } else {
    const reply = validateReply(unwrapModelObject(result.value, "reply"), observation, options.addressedPlayerId);
    action = { type: "speak", ...reply };
    computed = reply;
  }
  return {
    action,
    ...(selectionMemory ? { selectionMemory } : {}),
    audit: {
      version: 1, id: crypto.randomUUID(), at: new Date().toISOString(), roundId: observation.roundId,
      botId: observation.self.id, task, personaVersion: PERSONA_VERSION, promptVersion: PROMPT_VERSION,
      model: result.model, request, result: { modelOutput: result.value, computed, action },
      elapsedMs: result.elapsedMs, ...(result.requestId ? { requestId: result.requestId } : {}),
    },
  };
}

/** Model work runs outside the game's transaction. Stale or repeated jobs cannot become moves. */
export async function performBotJob(adapter: BotRoomAdapter, model: JsonModel, request: BotTaskRequest, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const lease = await adapter.claim(request);
  if (!lease) return { status: "unavailable" as const };
  try {
    if (lease.roundId !== lease.observation.roundId || lease.observation.self.id !== request.botId) throw new BotError("invalid_lease", "The task lease does not match the bot or round.");
    const remaining = lease.expiresAt - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 120_000) throw new BotError("invalid_lease", "The bot task lease is invalid or expired.");
    const deadline = AbortSignal.timeout(Math.max(1, Math.floor(remaining)));
    const effectiveSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const proposal = await generateBotProposal(lease.observation, request.task, model, { addressedPlayerId: request.addressedPlayerId, signal: effectiveSignal });
    effectiveSignal.throwIfAborted();
    const applied = await adapter.commit(lease, proposal);
    if (!applied) await adapter.release(lease, "stale");
    return { status: applied ? "applied" as const : "stale" as const, auditId: proposal.audit.id };
  } catch (error) {
    const code = error instanceof BotError ? error.code : signal?.aborted ? "cancelled" : "generation_failed";
    await adapter.release(lease, code);
    throw error;
  }
}
