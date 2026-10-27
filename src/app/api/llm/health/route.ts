import { NextResponse } from "next/server";
import { probeLlmHealth } from "@/lib/llm/llm-client";

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

/**
 * Health-check the configured / requested OpenAI-compatible LLM base URL.
 * GET  /api/llm/health?baseUrl=...
 * POST /api/llm/health  { "baseUrl"?: string }
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

    const result = await probeLlmHealth({
      baseUrl,
      signal: request.signal,
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 503 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Health check failed";
    return errorResponse(500, "health_check_failed", message);
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
