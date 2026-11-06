import { env as serverEnvironment } from "node:process";
import { BotError, type JsonModel, type JsonModelRequest, type ModelResult } from "./types";

/** Server-only. Never expose this configuration or create providers from browser input. */
export type ProviderConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxOutputTokens?: number;
};
export type ProviderEnvironment = Record<string, string | undefined>;
export type FetchImplementation = typeof fetch;

function positiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < 1 || result > maximum) {
    throw new BotError("invalid_configuration", "AI service limits are invalid.");
  }
  return result;
}

export function normalizeProviderConfig(config: ProviderConfig): Required<ProviderConfig> {
  if (!config.apiKey?.trim() || !config.model?.trim()) {
    throw new BotError("not_configured", "Configure the server-side AI key and an explicit model before enabling AI players.");
  }
  if (/[\r\n]/.test(config.apiKey) || !/^[\w./:-]{1,200}$/.test(config.model)) {
    throw new BotError("invalid_configuration", "AI service configuration is invalid.");
  }
  let url: URL;
  try { url = new URL(config.baseUrl); } catch {
    throw new BotError("invalid_configuration", "AI service base URL is invalid.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash) {
    throw new BotError("invalid_configuration", "Use an HTTPS AI endpoint, or an explicitly configured loopback HTTP endpoint, without credentials or query parameters in its URL.");
  }
  return {
    baseUrl: url.href.replace(/\/+$/, ""),
    apiKey: config.apiKey.trim(),
    model: config.model.trim(),
    timeoutMs: positiveInteger(config.timeoutMs, 20_000, 120_000),
    maxResponseBytes: positiveInteger(config.maxResponseBytes, 1_048_576, 4_194_304),
    maxOutputTokens: positiveInteger(config.maxOutputTokens, 1800, 8192),
  };
}

export function readProviderConfig(environment: ProviderEnvironment = serverEnvironment, modelVariable = "JUKEBOX_AI_MODEL"): Required<ProviderConfig> {
  const number = (key: string) => environment[key] ? Number(environment[key]) : undefined;
  return normalizeProviderConfig({
    baseUrl: environment.JUKEBOX_AI_BASE_URL || "https://api.openai.com/v1",
    apiKey: environment.JUKEBOX_AI_API_KEY || "",
    model: environment[modelVariable] || "",
    timeoutMs: number("JUKEBOX_AI_TIMEOUT_MS"),
    maxResponseBytes: number("JUKEBOX_AI_MAX_RESPONSE_BYTES"),
    maxOutputTokens: number("JUKEBOX_AI_MAX_OUTPUT_TOKENS"),
  });
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new BotError("cancelled", "AI request was cancelled."));
  return new Promise<T>((resolve, reject) => {
    const stop = () => { cleanup(); reject(new BotError("cancelled", "AI request was cancelled.")); };
    const cleanup = () => signal.removeEventListener("abort", stop);
    signal.addEventListener("abort", stop, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

function cancelBody(response: Response) {
  try { void response.body?.cancel().catch(() => undefined); } catch { /* Already closed. */ }
}

async function readBoundedJson(response: Response, limit: number, signal: AbortSignal): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    cancelBody(response);
    throw new BotError("response_too_large", "AI service response exceeded the configured size limit.");
  }
  if (!response.body) throw new BotError("invalid_response", "AI service returned an empty response.");
  const reader = response.body.getReader();
  let length = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await withAbort(reader.read(), signal);
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new BotError("response_too_large", "AI service response exceeded the configured size limit.");
      parts.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch {
    throw new BotError("invalid_response", "AI service returned invalid JSON.");
  }
}

/** Shared bounded transport. Paths are constants supplied by server adapters, never a client URL. */
export async function requestProviderJson(
  configInput: ProviderConfig,
  path: "chat/completions" | "audio/transcriptions",
  body: string | FormData,
  signal?: AbortSignal,
  fetchImplementation: FetchImplementation = fetch,
): Promise<{ value: unknown; elapsedMs: number; requestId?: string }> {
  const config = normalizeProviderConfig(configInput);
  if (signal?.aborted) throw new BotError("cancelled", "AI request was cancelled.");
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeoutMs);
  const start = performance.now();
  try {
    const response = await withAbort(fetchImplementation(`${config.baseUrl}/${path}`, {
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${config.apiKey}`, ...(typeof body === "string" ? { "Content-Type": "application/json" } : {}) },
      body,
      signal: controller.signal,
    }), controller.signal);
    if (!response.ok) {
      cancelBody(response);
      // Do not log provider error bodies: upstream services can echo prompts or credentials.
      throw new BotError(response.status === 429 ? "rate_limited" : "provider_http_error", `AI service could not complete the request (HTTP ${response.status}).`);
    }
    const value = await readBoundedJson(response, config.maxResponseBytes, controller.signal);
    const requestId = response.headers.get("x-request-id");
    return {
      value,
      elapsedMs: Math.round(performance.now() - start),
      ...(requestId && /^[\w.:-]{1,200}$/.test(requestId) && !requestId.includes(config.apiKey) ? { requestId } : {}),
    };
  } catch (error) {
    if (signal?.aborted) throw new BotError("cancelled", "AI request was cancelled.");
    if (timedOut) throw new BotError("timeout", "AI service did not respond in time.");
    if (error instanceof BotError) throw error;
    throw new BotError("network_error", "AI service could not be reached.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function strictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  function visit(value: unknown, depth: number): unknown {
    if (depth > 20) throw new BotError("invalid_request", "AI output schema is too deeply nested.");
    if (Array.isArray(value)) return value.map(item => visit(item, depth + 1));
    if (!value || typeof value !== "object") return value;
    const source = value as Record<string, unknown>;
    const result = Object.fromEntries(Object.entries(source).map(([key, item]) => [key, visit(item, depth + 1)]));
    if (source.type === "object") {
      if (!source.properties || typeof source.properties !== "object" || Array.isArray(source.properties)) {
        throw new BotError("invalid_request", "AI object schemas must declare their properties.");
      }
      result.additionalProperties = false;
      result.required = Object.keys(source.properties);
    }
    return result;
  }
  if (schema.type !== "object") throw new BotError("invalid_request", "AI output schema must have an object root.");
  const normalized = visit(schema, 0) as Record<string, unknown>;
  if (JSON.stringify(normalized).length > 65_536) throw new BotError("invalid_request", "AI output schema is too large.");
  return normalized;
}

function usageOf(value: unknown): ModelResult["usage"] {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const valid = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 100_000_000;
  return valid(usage.prompt_tokens) && valid(usage.completion_tokens) ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens } : undefined;
}

export function createJsonModel(configInput: ProviderConfig, fetchImplementation: FetchImplementation = fetch): JsonModel {
  const config = normalizeProviderConfig(configInput);
  return {
    async generate(request: JsonModelRequest, signal?: AbortSignal): Promise<ModelResult> {
      if (!/^[\w-]{1,64}$/.test(request.task) || !Array.isArray(request.messages) || !request.messages.length || request.messages.length > 100) {
        throw new BotError("invalid_request", "AI request format is invalid.");
      }
      const messages = request.messages.map(message => {
        if (!["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string") {
          throw new BotError("invalid_request", "AI message format is invalid.");
        }
        return { role: message.role, content: message.content };
      });
      const payload = JSON.stringify({
        model: config.model,
        messages,
        max_completion_tokens: config.maxOutputTokens,
        stream: false,
        store: false,
        response_format: { type: "json_schema", json_schema: { name: request.task, strict: true, schema: strictSchema(request.schema) } },
      });
      if (Buffer.byteLength(payload) > 262_144) throw new BotError("invalid_request", "AI request is too large.");
      const response = await requestProviderJson(config, "chat/completions", payload, signal, fetchImplementation);
      const envelope = response.value as { choices?: { finish_reason?: string; message?: { content?: unknown; refusal?: unknown } }[]; usage?: unknown } | null;
      const choice = envelope?.choices?.[0];
      if (choice?.message?.refusal) throw new BotError("provider_refusal", "AI service declined this response.");
      if (choice?.finish_reason !== "stop" || typeof choice.message?.content !== "string") {
        throw new BotError("invalid_response", "AI service returned an incomplete or unsupported response.");
      }
      let value: unknown;
      try { value = JSON.parse(choice.message.content); } catch {
        throw new BotError("invalid_response", "AI service returned invalid structured content.");
      }
      return { value, model: config.model, elapsedMs: response.elapsedMs, ...(response.requestId ? { requestId: response.requestId } : {}), ...(usageOf(envelope?.usage) ? { usage: usageOf(envelope?.usage) } : {}) };
    },
  };
}

export function createJsonModelFromEnv(environment: ProviderEnvironment = serverEnvironment, fetchImplementation: FetchImplementation = fetch): JsonModel {
  return createJsonModel(readProviderConfig(environment), fetchImplementation);
}
