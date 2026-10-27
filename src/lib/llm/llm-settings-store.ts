import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { ensureStorageDirs } from "@/lib/storage";

/**
 * Runtime LLM settings persisted under ./storage (not secrets in source).
 * Priority when resolving: request override → this file → process.env → safe localhost fallback.
 */

export interface LlmPersistedSettings {
  /** OpenAI-compatible base URL (e.g. http://localhost:11434/v1). */
  baseUrl: string | null;
  /** Preferred model id from /v1/models. */
  model: string | null;
  /** Optional named presets (label + url only — no baked-in IPs). */
  presets: Array<{ id: string; label: string; baseUrl: string }>;
  updated_at: string | null;
}

const SETTINGS_FILENAME = "llm-settings.json";

const EMPTY: LlmPersistedSettings = {
  baseUrl: null,
  model: null,
  presets: [],
  updated_at: null,
};

async function settingsFilePath(): Promise<string> {
  // Keep config next to uploads/vectordb under the storage root parent.
  const { storagePath } = await ensureStorageDirs();
  const storageRoot = path.dirname(storagePath);
  await mkdir(storageRoot, { recursive: true });
  return path.join(storageRoot, SETTINGS_FILENAME);
}

export async function readLlmSettings(): Promise<LlmPersistedSettings> {
  try {
    const raw = await readFile(await settingsFilePath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<LlmPersistedSettings>;
    return {
      baseUrl:
        typeof parsed.baseUrl === "string" && parsed.baseUrl.trim()
          ? parsed.baseUrl.trim()
          : null,
      model:
        typeof parsed.model === "string" && parsed.model.trim()
          ? parsed.model.trim()
          : null,
      presets: Array.isArray(parsed.presets)
        ? parsed.presets
            .filter(
              (p): p is { id: string; label: string; baseUrl: string } =>
                !!p &&
                typeof p.id === "string" &&
                typeof p.label === "string" &&
                typeof p.baseUrl === "string" &&
                p.baseUrl.trim().length > 0,
            )
            .map((p) => ({
              id: p.id,
              label: p.label,
              baseUrl: p.baseUrl.trim().replace(/\/+$/, ""),
            }))
        : [],
      updated_at:
        typeof parsed.updated_at === "string" ? parsed.updated_at : null,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ...EMPTY, presets: [] };
    throw err;
  }
}

export async function writeLlmSettings(
  patch: Partial<
    Pick<LlmPersistedSettings, "baseUrl" | "model" | "presets">
  >,
): Promise<LlmPersistedSettings> {
  const current = await readLlmSettings();
  const next: LlmPersistedSettings = {
    baseUrl:
      patch.baseUrl === undefined
        ? current.baseUrl
        : patch.baseUrl && String(patch.baseUrl).trim()
          ? String(patch.baseUrl).trim().replace(/\/+$/, "")
          : null,
    model:
      patch.model === undefined
        ? current.model
        : patch.model && String(patch.model).trim()
          ? String(patch.model).trim()
          : null,
    presets: patch.presets !== undefined ? patch.presets : current.presets,
    updated_at: new Date().toISOString(),
  };

  await writeFile(
    await settingsFilePath(),
    JSON.stringify(next, null, 2),
    "utf-8",
  );
  return next;
}
