import { NextResponse } from "next/server";
import {
  DEFAULT_LLM_BASE_URL,
  fetchLlmModels,
  LlmRequestError,
  resolveLlmBaseUrl,
} from "@/lib/llm/llm-client";

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

/**
 * GET /api/llm/models?server_url=...
 * Proxies to `{server_url}/models` (OpenAI-compatible).
 * Falls back to default Active Server (201) when server_url is omitted.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const serverUrl =
      url.searchParams.get("server_url") ||
      url.searchParams.get("baseUrl") ||
      url.searchParams.get("base_url") ||
      undefined;

    const baseUrl = resolveLlmBaseUrl(serverUrl);
    const result = await fetchLlmModels(baseUrl, request.signal);

    return NextResponse.json({
      object: "list",
      data: result.models,
      models: result.models,
      base_url: result.base_url,
      default_base_url: DEFAULT_LLM_BASE_URL,
    });
  } catch (err) {
    if (err instanceof LlmRequestError) {
      return errorResponse(err.status, "llm_models_failed", err.message);
    }
    const message =
      err instanceof Error ? err.message : "Failed to list LLM models";
    return errorResponse(502, "llm_models_failed", message);
  }
}
