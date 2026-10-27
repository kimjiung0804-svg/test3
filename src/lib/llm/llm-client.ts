/**
 * Streaming OpenAI-compatible chat client.
 * Default Active Server = http://192.168.0.201:11434 (no /v1 suffix;
 * chatCompletionsUrl / modelsListUrl append /v1/... as needed).
 * LOCAL_LLM_BASE_URL is an optional override only (never required).
 */

export const DEFAULT_LLM_BASE_URL = "http://192.168.0.201:11434";

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

/** Strip trailing slashes from an OpenAI-compatible base URL. */
export function normalizeLlmBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/**
 * Resolve LLM base URL.
 * Priority: explicit override → LOCAL_LLM_BASE_URL (optional) → default 201.
 * Never throws for a missing env var.
 */
export function resolveLlmBaseUrl(override?: string | null): string {
  if (typeof override === "string" && override.trim()) {
    return normalizeLlmBaseUrl(override);
  }
  const env = process.env.LOCAL_LLM_BASE_URL;
  if (typeof env === "string" && env.trim()) {
    return normalizeLlmBaseUrl(env);
  }
  return DEFAULT_LLM_BASE_URL;
}

/** @deprecated Prefer resolveLlmBaseUrl — kept for callers; does not throw. */
export function getLocalLlmBaseUrl(): string {
  return resolveLlmBaseUrl();
}

/**
 * Resolve model id.
 * Priority: explicit override → LOCAL_LLM_MODEL / LLM_MODEL → default.
 */
export function resolveLlmModel(override?: string | null): string {
  if (typeof override === "string" && override.trim()) {
    return override.trim();
  }
  return (
    process.env.LOCAL_LLM_MODEL?.trim() ||
    process.env.LLM_MODEL?.trim() ||
    "llama3.2-vision:11b"
  );
}

export function getLocalLlmModel(): string {
  return resolveLlmModel();
}

export function chatCompletionsUrl(baseUrl: string): string {
  const base = normalizeLlmBaseUrl(baseUrl);
  if (/\/chat\/completions$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

/** Build `{base}/models` for OpenAI-compatible servers (handles trailing /v1). */
export function modelsListUrl(baseUrl: string): string {
  const base = normalizeLlmBaseUrl(baseUrl);
  if (/\/models$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/models`;
  return `${base}/v1/models`;
}

export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamChatOptions {
  messages: ChatCompletionMessage[];
  /** Client-selected OpenAI-compatible base URL (preferred over env/default). */
  baseUrl?: string;
  model?: string;
  temperature?: number;
  signal?: AbortSignal;
}

export interface LlmModelInfo {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

/**
 * Fetch model list from an OpenAI-compatible server (`GET …/models`).
 */
export async function fetchLlmModels(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<{ models: LlmModelInfo[]; base_url: string; raw?: unknown }> {
  const resolved = resolveLlmBaseUrl(baseUrl);
  const url = modelsListUrl(resolved);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "LLM models request failed";
    throw new LlmRequestError(
      `Failed to reach LLM models at ${url}: ${msg}`,
      502,
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new LlmRequestError(
      `LLM models error ${response.status}: ${body.slice(0, 400)}`,
      response.status >= 400 && response.status < 600 ? response.status : 502,
    );
  }

  const data = (await response.json()) as {
    data?: LlmModelInfo[];
    models?: LlmModelInfo[];
  };
  const list = Array.isArray(data.data)
    ? data.data
    : Array.isArray(data.models)
      ? data.models
      : [];

  return {
    models: list.filter((m) => m && typeof m.id === "string"),
    base_url: resolved,
    raw: data,
  };
}

/**
 * Lightweight connectivity probe against the models endpoint.
 */
export async function checkLlmHealth(
  baseUrl?: string | null,
  signal?: AbortSignal,
): Promise<{
  ok: boolean;
  base_url: string;
  models_url: string;
  model_count?: number;
  latency_ms: number;
  error?: string;
}> {
  const resolved = resolveLlmBaseUrl(baseUrl);
  const url = modelsListUrl(resolved);
  const started = Date.now();

  try {
    const result = await fetchLlmModels(resolved, signal);
    return {
      ok: true,
      base_url: resolved,
      models_url: url,
      model_count: result.models.length,
      latency_ms: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      base_url: resolved,
      models_url: url,
      latency_ms: Date.now() - started,
      error: err instanceof Error ? err.message : "Health check failed",
    };
  }
}

/**
 * Stream assistant text tokens from the OpenAI-compatible LLM.
 * Uses options.baseUrl when provided; otherwise env override or default 201.
 */
export async function* streamChatCompletion(
  options: StreamChatOptions,
): AsyncGenerator<string, void, unknown> {
  const baseUrl = resolveLlmBaseUrl(options.baseUrl);
  const url = chatCompletionsUrl(baseUrl);
  const model = resolveLlmModel(options.model);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    throw new LlmRequestError(`Failed to reach local LLM at ${url}: ${msg}`, 502);
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
  const baseUrl = resolveLlmBaseUrl(options.baseUrl);
  const url = chatCompletionsUrl(baseUrl);
  const model = resolveLlmModel(options.model);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    throw new LlmRequestError(`Failed to reach local LLM at ${url}: ${msg}`, 502);
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
