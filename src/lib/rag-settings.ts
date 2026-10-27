import {
  isLlmServerPresetId,
  normalizeUiServerUrl,
  resolveActiveServerUrl,
  type LlmServerPresetId,
} from "@/lib/llm-servers";

export interface RagSettings {
  chunk_size: number;
  chunk_overlap: number;
  top_k: number;
  similarity_threshold: number;
  temperature: number;
  max_tokens: number;
  /** UI preset: Server A / B / Custom (persisted locally). */
  server_preset: LlmServerPresetId;
  /** Custom base URL when server_preset === "custom" (no /v1). */
  custom_server_url: string;
  /** Selected model id from the active server's /v1/models list. */
  selected_model: string;
}

export const DEFAULT_RAG_SETTINGS: RagSettings = {
  chunk_size: 500,
  chunk_overlap: 50,
  top_k: 5,
  similarity_threshold: 0.5,
  temperature: 0.7,
  max_tokens: 1000,
  server_preset: "a",
  custom_server_url: "",
  selected_model: "",
};

const STORAGE_KEY = "rag-doc-chat-settings";

export function loadRagSettings(): RagSettings {
  if (typeof window === "undefined") return { ...DEFAULT_RAG_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_RAG_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<RagSettings>;
    const server_preset = isLlmServerPresetId(parsed.server_preset)
      ? parsed.server_preset
      : DEFAULT_RAG_SETTINGS.server_preset;
    const custom_server_url =
      typeof parsed.custom_server_url === "string"
        ? normalizeUiServerUrl(parsed.custom_server_url)
        : DEFAULT_RAG_SETTINGS.custom_server_url;
    const selected_model =
      typeof parsed.selected_model === "string"
        ? parsed.selected_model.trim()
        : DEFAULT_RAG_SETTINGS.selected_model;

    return {
      ...DEFAULT_RAG_SETTINGS,
      ...parsed,
      server_preset,
      custom_server_url,
      selected_model,
    };
  } catch {
    return { ...DEFAULT_RAG_SETTINGS };
  }
}

export function saveRagSettings(settings: RagSettings): void {
  if (typeof window === "undefined") return;
  const normalized: RagSettings = {
    ...settings,
    custom_server_url: normalizeUiServerUrl(settings.custom_server_url),
    selected_model: settings.selected_model.trim(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(
    new CustomEvent("rag-settings-changed", { detail: normalized }),
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

export function shortId(id: string, len = 8): string {
  return id.slice(0, len);
}

/** Convenience: active server_url from persisted settings (no /v1). */
export function getActiveServerUrl(settings: RagSettings): string {
  return resolveActiveServerUrl(settings);
}
