export interface RagSettings {
  chunk_size: number;
  chunk_overlap: number;
  top_k: number;
  similarity_threshold: number;
  temperature: number;
  max_tokens: number;
}

export const DEFAULT_RAG_SETTINGS: RagSettings = {
  chunk_size: 500,
  chunk_overlap: 50,
  top_k: 5,
  similarity_threshold: 0.5,
  temperature: 0.7,
  max_tokens: 1000,
};

const STORAGE_KEY = "rag-doc-chat-settings";

export function loadRagSettings(): RagSettings {
  if (typeof window === "undefined") return { ...DEFAULT_RAG_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_RAG_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<RagSettings>;
    return { ...DEFAULT_RAG_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_RAG_SETTINGS };
  }
}

export function saveRagSettings(settings: RagSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent("rag-settings-changed", { detail: settings }));
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