/**
 * Streaming OpenAI-compatible chat client.
 * Base URL MUST come only from process.env.LOCAL_LLM_BASE_URL (no hardcoding).
 */

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

/** Read and normalize LOCAL_LLM_BASE_URL. Throws if unset. */
export function getLocalLlmBaseUrl(): string {
  const raw = process.env.LOCAL_LLM_BASE_URL;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new LlmConfigError(
      "LOCAL_LLM_BASE_URL is not set. Configure it in .env.local.",
    );
  }
  return raw.trim().replace(/\/+$/, "");
}

export function getLocalLlmModel(): string {
  return (
    process.env.LOCAL_LLM_MODEL?.trim() ||
    process.env.LLM_MODEL?.trim() ||
    "llama3.2-vision:11b"
  );
}

function chatCompletionsUrl(baseUrl: string): string {
  if (/\/chat\/completions$/i.test(baseUrl)) return baseUrl;
  if (/\/v1$/i.test(baseUrl)) return `${baseUrl}/chat/completions`;
  return `${baseUrl}/v1/chat/completions`;
}

export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamChatOptions {
  messages: ChatCompletionMessage[];
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
  const baseUrl = getLocalLlmBaseUrl();
  const url = chatCompletionsUrl(baseUrl);
  const model = options.model || getLocalLlmModel();

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
  const baseUrl = getLocalLlmBaseUrl();
  const url = chatCompletionsUrl(baseUrl);
  const model = options.model || getLocalLlmModel();

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
