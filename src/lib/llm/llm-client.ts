/**
 * Streaming OpenAI-compatible chat client.
 *
 * Base URL resolution (never bake real server IPs into source):
 *   1) per-request override
 *   2) persisted ./storage/llm-settings.json
 *   3) process.env.LOCAL_LLM_BASE_URL
 *   4) safe localhost placeholder matching .env.example
 */

import { readLlmSettings } from "@/lib/llm/llm-settings-store";

/** Same placeholder as `.env.example` — used only when env + settings are empty. */
export const DEFAULT_LLM_BASE_URL = "http://localhost:11434/v1";

export class LlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmConfigError";
  }
}

export class LlmRequestError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "LlmRequestError";
    this.status = status;
  }
}

export function normalizeLlmBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/** Env-only default (may be empty). Does not throw. */
export function getEnvLlmBaseUrl(): string | null {
  const raw = process.env.LOCAL_LLM_BASE_URL;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return normalizeLlmBaseUrl(raw);
}

export function getEnvLlmModel(): string | null {
  const raw =
    process.env.LOCAL_LLM_MODEL?.trim() || process.env.LLM_MODEL?.trim() || "";
  return raw || null;
}

/**
 * Sync env → localhost fallback (no disk). Prefer `resolveLlmBaseUrl` when
 * request/persisted overrides matter.
 */
export function getLocalLlmBaseUrl(): string {
  return getEnvLlmBaseUrl() ?? DEFAULT_LLM_BASE_URL;
}

export function getLocalLlmModel(): string {
  return getEnvLlmModel() ?? "llama3.2";
}

export type LlmUrlSource =
  | "override"
  | "settings"
  | "env"
  | "default_fallback";

export interface ResolvedLlmEndpoint {
  baseUrl: string;
  model: string | null;
  source: LlmUrlSource;
}

/** Full resolve: override → persisted settings → env → localhost fallback. */
export async function resolveLlmEndpoint(options?: {
  baseUrl?: string | null;
  model?: string | null;
}): Promise<ResolvedLlmEndpoint> {
  const overrideUrl =
    typeof options?.baseUrl === "string" && options.baseUrl.trim()
      ? normalizeLlmBaseUrl(options.baseUrl)
      : null;
  const overrideModel =
    typeof options?.model === "string" && options.model.trim()
      ? options.model.trim()
      : null;

  if (overrideUrl) {
    return {
      baseUrl: overrideUrl,
      model: overrideModel ?? (await readLlmSettings()).model ?? getEnvLlmModel(),
      source: "override",
    };
  }

  const settings = await readLlmSettings();
  if (settings.baseUrl) {
    return {
      baseUrl: normalizeLlmBaseUrl(settings.baseUrl),
      model: overrideModel ?? settings.model ?? getEnvLlmModel(),
      source: "settings",
    };
  }

  const envUrl = getEnvLlmBaseUrl();
  if (envUrl) {
    return {
      baseUrl: envUrl,
      model: overrideModel ?? settings.model ?? getEnvLlmModel(),
      source: "env",
    };
  }

  return {
    baseUrl: DEFAULT_LLM_BASE_URL,
    model: overrideModel ?? settings.model ?? getEnvLlmModel(),
    source: "default_fallback",
  };
}

/** Build .../v1/chat/completions from a base that may already include /v1. */
export function chatCompletionsUrl(baseUrl: string): string {
  const base = normalizeLlmBaseUrl(baseUrl);
  if (/\/chat\/completions$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

/** Build .../v1/models from a base that may already include /v1. */
export function modelsUrl(baseUrl: string): string {
  const base = normalizeLlmBaseUrl(baseUrl);
  if (/\/models$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/models`;
  return `${base}/v1/models`;
}

function llmHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey = process.env.LOCAL_LLM_API_KEY?.trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamChatOptions {
  messages: ChatCompletionMessage[];
  /** Per-request OpenAI-compatible base URL override (UI selection). */
  baseUrl?: string;
  model?: string;
  temperature?: number;
  signal?: AbortSignal;
}

/**
 * Stream assistant text tokens from the local OpenAI-compatible LLM.
 * Yields content deltas as they arrive.
 */
export async function* streamChatCompletion(
  options: StreamChatOptions,
): AsyncGenerator<string, void, unknown> {
  const resolved = await resolveLlmEndpoint({
    baseUrl: options.baseUrl,
    model: options.model,
  });
  const url = chatCompletionsUrl(resolved.baseUrl);
  const model = resolved.model || getLocalLlmModel();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: llmHeaders(),
      body: JSON.stringify({
        model,
        messages: options.messages,
        stream: true,
        temperature: options.temperature ?? 0.2,
      }),
      signal: options.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "LLM request failed";
    throw new LlmRequestError(
      `Failed to reach local LLM at ${url}: ${msg}`,
      502,
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new LlmRequestError(
      `Local LLM error ${response.status}: ${body.slice(0, 400)}`,
      response.status >= 400 && response.status < 600 ? response.status : 502,
    );
  }

  if (!response.body) {
    throw new LlmRequestError("Local LLM returned an empty body", 502);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) continue;
      if (!trimmed.startsWith("data:")) continue;

      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return;

      try {
        const parsed = JSON.parse(payload) as {
          choices?: Array<{
            delta?: { content?: string };
            message?: { content?: string };
          }>;
        };
        const delta =
          parsed.choices?.[0]?.delta?.content ??
          parsed.choices?.[0]?.message?.content;
        if (typeof delta === "string" && delta.length > 0) {
          yield delta;
        }
      } catch {
        /* skip malformed SSE chunks */
      }
    }
  }
}

/** Non-streaming completion (useful for tests / fallbacks). */
export async function chatCompletion(
  options: StreamChatOptions,
): Promise<string> {
  const resolved = await resolveLlmEndpoint({
    baseUrl: options.baseUrl,
    model: options.model,
  });
  const url = chatCompletionsUrl(resolved.baseUrl);
  const model = resolved.model || getLocalLlmModel();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: llmHeaders(),
      body: JSON.stringify({
        model,
        messages: options.messages,
        stream: false,
        temperature: options.temperature ?? 0.2,
      }),
      signal: options.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "LLM request failed";
    throw new LlmRequestError(
      `Failed to reach local LLM at ${url}: ${msg}`,
      502,
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new LlmRequestError(
      `Local LLM error ${response.status}: ${body.slice(0, 400)}`,
      502,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

/** Probe an OpenAI-compatible base URL (GET /v1/models). */
export async function probeLlmHealth(options?: {
  baseUrl?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{
  ok: boolean;
  baseUrl: string;
  source: LlmUrlSource;
  models_url: string;
  latency_ms: number;
  status?: number;
  model_count?: number;
  error?: string;
}> {
  const resolved = await resolveLlmEndpoint({ baseUrl: options?.baseUrl });
  const url = modelsUrl(resolved.baseUrl);
  const timeoutMs = options?.timeoutMs ?? 5000;
  const started = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  options?.signal?.addEventListener("abort", onAbort);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: llmHeaders(),
      signal: controller.signal,
    });
    const latency_ms = Date.now() - started;

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        baseUrl: resolved.baseUrl,
        source: resolved.source,
        models_url: url,
        latency_ms,
        status: response.status,
        error: body.slice(0, 300) || `HTTP ${response.status}`,
      };
    }

    const data = (await response.json().catch(() => null)) as {
      data?: unknown[];
    } | null;
    const model_count = Array.isArray(data?.data) ? data.data.length : undefined;

    return {
      ok: true,
      baseUrl: resolved.baseUrl,
      source: resolved.source,
      models_url: url,
      latency_ms,
      status: response.status,
      model_count,
    };
  } catch (err) {
    const latency_ms = Date.now() - started;
    const msg =
      err instanceof Error
        ? err.name === "AbortError"
          ? `Timed out after ${timeoutMs}ms`
          : err.message
        : "Health check failed";
    return {
      ok: false,
      baseUrl: resolved.baseUrl,
      source: resolved.source,
      models_url: url,
      latency_ms,
      error: msg,
    };
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener("abort", onAbort);
  }
}

/** Proxy GET {base}/v1/models. */
export async function fetchLlmModels(options?: {
  baseUrl?: string | null;
  signal?: AbortSignal;
}): Promise<{
  baseUrl: string;
  source: LlmUrlSource;
  models_url: string;
  object: string;
  data: Array<{ id: string; object?: string; owned_by?: string; [k: string]: unknown }>;
}> {
  const resolved = await resolveLlmEndpoint({ baseUrl: options?.baseUrl });
  const url = modelsUrl(resolved.baseUrl);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: llmHeaders(),
      signal: options?.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Models request failed";
    throw new LlmRequestError(
      `Failed to reach models endpoint at ${url}: ${msg}`,
      502,
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new LlmRequestError(
      `Models proxy error ${response.status}: ${body.slice(0, 400)}`,
      response.status >= 400 && response.status < 600 ? response.status : 502,
    );
  }

  const data = (await response.json()) as {
    object?: string;
    data?: Array<{ id: string; object?: string; owned_by?: string }>;
  };

  return {
    baseUrl: resolved.baseUrl,
    source: resolved.source,
    models_url: url,
    object: data.object ?? "list",
    data: Array.isArray(data.data) ? data.data : [],
  };
}
