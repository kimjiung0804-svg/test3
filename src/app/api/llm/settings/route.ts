import { NextResponse } from "next/server";
import {
  DEFAULT_LLM_BASE_URL,
  getEnvLlmBaseUrl,
  getEnvLlmModel,
  resolveLlmEndpoint,
} from "@/lib/llm/llm-client";
import {
  readLlmSettings,
  writeLlmSettings,
  type LlmPersistedSettings,
} from "@/lib/llm/llm-settings-store";

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

async function settingsPayload(persisted: LlmPersistedSettings) {
  const resolved = await resolveLlmEndpoint();
  return {
    settings: persisted,
    env: {
      LOCAL_LLM_BASE_URL: getEnvLlmBaseUrl(),
      LOCAL_LLM_MODEL: getEnvLlmModel(),
    },
    defaults: {
      baseUrl: DEFAULT_LLM_BASE_URL,
    },
    effective: {
      baseUrl: resolved.baseUrl,
      model: resolved.model,
      source: resolved.source,
    },
  };
}

/** GET /api/llm/settings — persisted + effective LLM server/model. */
export async function GET() {
  try {
    const persisted = await readLlmSettings();
    return NextResponse.json(await settingsPayload(persisted));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load settings";
    return errorResponse(500, "settings_read_failed", message);
  }
}

interface SettingsBody {
  baseUrl?: string | null;
  model?: string | null;
  presets?: LlmPersistedSettings["presets"];
}

/** PUT /api/llm/settings — persist selected server URL / model (local file). */
export async function PUT(request: Request) {
  try {
    let body: SettingsBody;
    try {
      body = (await request.json()) as SettingsBody;
    } catch {
      return errorResponse(400, "invalid_json", "Request body must be JSON");
    }

    if (
      body.baseUrl !== undefined &&
      body.baseUrl !== null &&
      typeof body.baseUrl !== "string"
    ) {
      return errorResponse(400, "invalid_request", "baseUrl must be a string or null");
    }
    if (
      body.model !== undefined &&
      body.model !== null &&
      typeof body.model !== "string"
    ) {
      return errorResponse(400, "invalid_request", "model must be a string or null");
    }

    const persisted = await writeLlmSettings({
      baseUrl: body.baseUrl,
      model: body.model,
      presets: body.presets,
    });

    return NextResponse.json(await settingsPayload(persisted));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save settings";
    return errorResponse(500, "settings_write_failed", message);
  }
}

/** POST mirrors PUT for clients that prefer POST. */
export async function POST(request: Request) {
  return PUT(request);
}
