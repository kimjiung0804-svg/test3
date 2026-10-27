import { NextResponse } from "next/server";
import {
  checkLlmHealth,
  DEFAULT_LLM_BASE_URL,
  resolveLlmBaseUrl,
} from "@/lib/llm/llm-client";

/**
 * GET /api/llm/health?server_url=...
 * POST /api/llm/health  body: { server_url?: string }
 * Connectivity probe against the selected (or default 201) LLM server.
 */
async function runHealth(serverUrl: string | undefined, signal?: AbortSignal) {
  const baseUrl = resolveLlmBaseUrl(serverUrl);
  const result = await checkLlmHealth(baseUrl, signal);
  return NextResponse.json(
    {
      ...result,
      default_base_url: DEFAULT_LLM_BASE_URL,
    },
    { status: result.ok ? 200 : 503 },
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const serverUrl =
    url.searchParams.get("server_url") ||
    url.searchParams.get("baseUrl") ||
    url.searchParams.get("base_url") ||
    undefined;
  return runHealth(serverUrl || undefined, request.signal);
}

export async function POST(request: Request) {
  let serverUrl: string | undefined;
  try {
    const body = (await request.json()) as {
      server_url?: string;
      baseUrl?: string;
      base_url?: string;
    };
    serverUrl = body.server_url || body.baseUrl || body.base_url || undefined;
  } catch {
    serverUrl = undefined;
  }
  return runHealth(serverUrl, request.signal);
}
