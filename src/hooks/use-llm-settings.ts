"use client";

import { useCallback, useEffect, useState } from "react";

export type LlmPreset = { id: string; label: string; baseUrl: string };

export type LlmSettingsState = {
  baseUrl: string;
  model: string;
  presets: LlmPreset[];
  envBaseUrl: string | null;
  envModel: string | null;
  defaultBaseUrl: string;
  source: string;
  ready: boolean;
  apiAvailable: boolean;
};

type SettingsApiResponse = {
  settings?: {
    baseUrl?: string | null;
    model?: string | null;
    presets?: LlmPreset[];
  };
  env?: {
    LOCAL_LLM_BASE_URL?: string | null;
    LOCAL_LLM_MODEL?: string | null;
  };
  defaults?: { baseUrl?: string };
  effective?: {
    baseUrl?: string;
    model?: string;
    source?: string;
  };
};

const EVENT = "llm-settings-changed";
const LOCAL_KEY = "rag-doc-chat-llm-settings-v1";
const DEFAULT_BASE = "http://localhost:11434/v1";

const INITIAL: LlmSettingsState = {
  baseUrl: DEFAULT_BASE,
  model: "",
  presets: [],
  envBaseUrl: null,
  envModel: null,
  defaultBaseUrl: DEFAULT_BASE,
  source: "default",
  ready: false,
  apiAvailable: false,
};

type LocalBlob = {
  baseUrl?: string;
  model?: string;
  presets?: LlmPreset[];
};

function loadLocal(): LocalBlob | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LocalBlob;
  } catch {
    return null;
  }
}

function saveLocal(blob: LocalBlob) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LOCAL_KEY, JSON.stringify(blob));
}

function applyPayload(
  prev: LlmSettingsState,
  data: SettingsApiResponse,
): LlmSettingsState {
  const effectiveBase =
    data.effective?.baseUrl ||
    data.settings?.baseUrl ||
    data.env?.LOCAL_LLM_BASE_URL ||
    data.defaults?.baseUrl ||
    prev.defaultBaseUrl;
  const effectiveModel =
    data.effective?.model ||
    data.settings?.model ||
    data.env?.LOCAL_LLM_MODEL ||
    "";
  return {
    baseUrl: effectiveBase,
    model: effectiveModel,
    presets: Array.isArray(data.settings?.presets) ? data.settings!.presets! : [],
    envBaseUrl: data.env?.LOCAL_LLM_BASE_URL ?? null,
    envModel: data.env?.LOCAL_LLM_MODEL ?? null,
    defaultBaseUrl: data.defaults?.baseUrl || prev.defaultBaseUrl,
    source: data.effective?.source || prev.source,
    ready: true,
    apiAvailable: true,
  };
}

function applyLocalFallback(prev: LlmSettingsState): LlmSettingsState {
  const local = loadLocal();
  return {
    ...prev,
    baseUrl: local?.baseUrl?.trim() || prev.defaultBaseUrl,
    model: local?.model?.trim() || "",
    presets: Array.isArray(local?.presets) ? local!.presets! : [],
    source: local?.baseUrl ? "localStorage" : "default",
    ready: true,
    apiAvailable: false,
  };
}

export function useLlmSettings() {
  const [state, setState] = useState<LlmSettingsState>(INITIAL);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/llm/settings");
      if (!res.ok) {
        setState((prev) => applyLocalFallback(prev));
        return;
      }
      const data = (await res.json()) as SettingsApiResponse;
      setState((prev) => applyPayload(prev, data));
    } catch {
      setState((prev) => applyLocalFallback(prev));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, [refresh]);

  const setLocal = useCallback(
    (patch: Partial<Pick<LlmSettingsState, "baseUrl" | "model" | "presets">>) => {
      setState((prev) => ({ ...prev, ...patch }));
    },
    [],
  );

  const persist = useCallback(
    async (patch?: {
      baseUrl?: string | null;
      model?: string | null;
      presets?: LlmPreset[];
    }) => {
      const body = {
        baseUrl:
          patch?.baseUrl !== undefined ? patch.baseUrl : state.baseUrl || null,
        model: patch?.model !== undefined ? patch.model : state.model || null,
        presets: patch?.presets !== undefined ? patch.presets : state.presets,
      };

      let apiOk = false;
      try {
        const res = await fetch("/api/llm/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = (await res.json()) as SettingsApiResponse;
          setState((prev) => applyPayload(prev, data));
          window.dispatchEvent(new Event(EVENT));
          apiOk = true;
          return data;
        }
        if (res.status !== 404 && state.apiAvailable) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || `Save failed (${res.status})`);
        }
      } catch (err) {
        if (apiOk) throw err;
        if (state.apiAvailable && !(err instanceof TypeError)) throw err;
      }

      // Stub contract: client persist until /api/llm/settings lands (ELEC-21).
      const next = {
        baseUrl:
          typeof body.baseUrl === "string" ? body.baseUrl : state.defaultBaseUrl,
        model: typeof body.model === "string" ? body.model : "",
        presets: Array.isArray(body.presets) ? body.presets : [],
      };
      saveLocal(next);
      setState((prev) => ({
        ...prev,
        ...next,
        source: "localStorage",
        ready: true,
        apiAvailable: false,
      }));
      window.dispatchEvent(new Event(EVENT));
      return { settings: next, effective: { ...next, source: "localStorage" } };
    },
    [
      state.apiAvailable,
      state.baseUrl,
      state.defaultBaseUrl,
      state.model,
      state.presets,
    ],
  );

  return { ...state, refresh, setLocal, persist };
}

export type LlmModelInfo = { id: string; owned_by?: string };

export async function fetchLlmModelsList(baseUrl?: string): Promise<{
  models: LlmModelInfo[];
  baseUrl: string;
  error?: string;
}> {
  try {
    const url = baseUrl?.trim()
      ? `/api/llm/models?baseUrl=${encodeURIComponent(baseUrl.trim())}`
      : "/api/llm/models";
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        models: [],
        baseUrl: typeof data.baseUrl === "string" ? data.baseUrl : baseUrl || "",
        error:
          res.status === 404
            ? "Models API pending (ELEC-21) — UI wired to /api/llm/models"
            : data.message || `Models failed (${res.status})`,
      };
    }
    const models = Array.isArray(data.data)
      ? (data.data as Array<{ id?: string; owned_by?: string }>)
          .filter((m) => typeof m.id === "string" && m.id)
          .map((m) => ({ id: m.id!, owned_by: m.owned_by }))
      : [];
    return {
      models,
      baseUrl: typeof data.baseUrl === "string" ? data.baseUrl : baseUrl || "",
    };
  } catch (err) {
    return {
      models: [],
      baseUrl: baseUrl || "",
      error: err instanceof Error ? err.message : "Models request failed",
    };
  }
}

export async function probeLlmHealthCheck(baseUrl?: string): Promise<{
  ok: boolean;
  baseUrl: string;
  latency_ms?: number;
  model_count?: number;
  error?: string;
}> {
  try {
    const res = await fetch("/api/llm/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(baseUrl?.trim() ? { baseUrl: baseUrl.trim() } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 404) {
      return {
        ok: false,
        baseUrl: baseUrl || "",
        error: "Health API pending (ELEC-21) — UI wired to /api/llm/health",
      };
    }
    return {
      ok: Boolean(data.ok),
      baseUrl: typeof data.baseUrl === "string" ? data.baseUrl : baseUrl || "",
      latency_ms: typeof data.latency_ms === "number" ? data.latency_ms : undefined,
      model_count:
        typeof data.model_count === "number" ? data.model_count : undefined,
      error: data.ok
        ? undefined
        : data.error || data.message || `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      baseUrl: baseUrl || "",
      error: err instanceof Error ? err.message : "Health check failed",
    };
  }
}
