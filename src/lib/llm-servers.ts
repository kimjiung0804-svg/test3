/**
 * UI presets for Multi-Server switch.
 * Base URLs intentionally omit `/v1` — OpenAI-compatible clients append
 * `/v1/models` and `/v1/chat/completions` themselves.
 */

export type LlmServerPresetId = "a" | "b" | "custom";

export interface LlmServerPreset {
  id: LlmServerPresetId;
  label: string;
  /** OpenAI-compatible host (no trailing /v1). Empty for custom. */
  url: string;
}

export const LLM_SERVER_PRESETS: readonly LlmServerPreset[] = [
  {
    id: "a",
    label: "Server A (201)",
    url: "http://192.168.0.201:11434",
  },
  {
    id: "b",
    label: "Server B (202)",
    url: "http://192.168.0.202:11434",
  },
  {
    id: "custom",
    label: "Custom",
    url: "",
  },
] as const;

export const DEFAULT_LLM_SERVER_URL = LLM_SERVER_PRESETS[0]!.url;

/** Strip trailing slashes and optional `/v1` so UI always stores the host base. */
export function normalizeUiServerUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v1$/i, "");
}

export function isLlmServerPresetId(value: unknown): value is LlmServerPresetId {
  return value === "a" || value === "b" || value === "custom";
}

export function presetById(id: LlmServerPresetId): LlmServerPreset {
  return LLM_SERVER_PRESETS.find((p) => p.id === id) ?? LLM_SERVER_PRESETS[0]!;
}

/** Active server_url to send to /api/chat and /api/llm/* (never includes /v1). */
export function resolveActiveServerUrl(opts: {
  server_preset: LlmServerPresetId;
  custom_server_url: string;
}): string {
  if (opts.server_preset === "custom") {
    const custom = normalizeUiServerUrl(opts.custom_server_url);
    return custom || DEFAULT_LLM_SERVER_URL;
  }
  return presetById(opts.server_preset).url;
}
