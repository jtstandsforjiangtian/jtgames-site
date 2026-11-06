import { env as serverEnvironment } from "node:process";
import { BotError, type Language } from "./types";
import { normalizeProviderConfig, readProviderConfig, requestProviderJson, type FetchImplementation, type ProviderConfig, type ProviderEnvironment } from "./provider.server";

export const MAX_RECORDING_BYTES = 8 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm", "video/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4", "video/mp4": "mp4",
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/flac": "flac", "audio/x-flac": "flac", "audio/m4a": "m4a", "audio/x-m4a": "m4a",
};
export type TranscriptionResult = { text: string; elapsedMs: number; model: string; requestId?: string };
export type Transcriber = { transcribe(recording: Blob, language: Language, signal?: AbortSignal): Promise<TranscriptionResult> };

/** Returns a draft only. The caller must let the player edit/confirm it before public submission. */
export function createTranscriber(configInput: ProviderConfig, fetchImplementation: FetchImplementation = fetch): Transcriber {
  const config = normalizeProviderConfig(configInput);
  return {
    async transcribe(recording, language, signal) {
      if (!(recording instanceof Blob) || recording.size < 1 || recording.size > MAX_RECORDING_BYTES) {
        throw new BotError("invalid_recording", "Record a non-empty audio clip smaller than 8 MiB.");
      }
      const mime = recording.type.split(";", 1)[0].trim().toLowerCase();
      const extension = MIME_EXTENSIONS[mime];
      if (!extension || !["en", "zh"].includes(language)) {
        throw new BotError("invalid_recording", "This recording format or language is not supported.");
      }
      const form = new FormData();
      form.append("file", recording, `recording.${extension}`);
      form.append("model", config.model);
      form.append("language", language);
      form.append("response_format", "json");
      const result = await requestProviderJson(config, "audio/transcriptions", form, signal, fetchImplementation);
      const text = (result.value as { text?: unknown } | null)?.text;
      if (typeof text !== "string" || text.length > 12_000) {
        throw new BotError("invalid_response", "Speech service returned an invalid transcript.");
      }
      return { text: text.trim(), elapsedMs: result.elapsedMs, model: config.model, ...(result.requestId ? { requestId: result.requestId } : {}) };
    },
  };
}

export function createTranscriberFromEnv(environment: ProviderEnvironment = serverEnvironment, fetchImplementation: FetchImplementation = fetch): Transcriber {
  return createTranscriber(readProviderConfig(environment, "JUKEBOX_TRANSCRIBE_MODEL"), fetchImplementation);
}
