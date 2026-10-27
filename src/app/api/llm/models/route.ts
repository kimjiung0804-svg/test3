import { NextResponse } from "next/server";
import {
  LlmRequestError,
  fetchLlmModels,
} from "@/lib/llm/llm-client";

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

/**
 * Proxy OpenAI-compatible `{base}/v1/models`.
 * GET  /api/llm/models?baseUrl=...
 * POST /api/llm/models  { "baseUrl"?: string }
 */
async function handle(request: Request) {
  try {
    let baseUrl: string | undefined;

    if (request.method === "GET") {
      const url = new URL(request.url);
      const q = url.searchParams.get("baseUrl");
      if (q?.trim()) baseUrl = q.trim();
    } else {
      try {
        const body = (await request.json()) as { baseUrl?: string };
        if (typeof body.baseUrl === "string" && body.baseUrl.trim()) {
          baseUrl = body.baseUrl.trim();
        }
      } catch {
        /* empty body → use resolved defaults */
      }
    }

    const result = await fetchLlmModels({
      baseUrl,
      signal: request.signal,
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof LlmRequestError) {
      return errorResponse(err.status, "models_proxy_failed", err.message);
    }
    const message = err instanceof Error ? err.message : "Models proxy failed";
    return errorResponse(500, "models_proxy_failed", message);
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
