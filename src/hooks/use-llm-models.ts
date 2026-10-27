"use client";

import { useEffect, useState } from "react";

export interface LlmModelOption {
  id: string;
  owned_by?: string;
}

type ModelsState = {
  models: LlmModelOption[];
  loading: boolean;
  error: string | null;
  baseUrl: string | null;
};

/**
 * Fetch installed models for the selected server via the app proxy
 * `GET /api/llm/models?server_url=...`. Refetches when server_url changes.
 */
export function useLlmModels(serverUrl: string) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [state, setState] = useState<ModelsState>({
    models: [],
    loading: true,
    error: null,
    baseUrl: null,
  });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      setState((prev) => ({
        ...prev,
        loading: true,
        error: null,
      }));

      try {
        const qs = new URLSearchParams({ server_url: serverUrl });
        const res = await fetch(`/api/llm/models?${qs.toString()}`, {
          signal: controller.signal,
        });
        const body = (await res.json().catch(() => ({}))) as {
          models?: Array<{ id?: string; owned_by?: string }>;
          data?: Array<{ id?: string; owned_by?: string }>;
          base_url?: string;
          message?: string;
          error?: string;
        };

        if (cancelled) return;

        if (!res.ok) {
          setState({
            models: [],
            loading: false,
            error: body.message || body.error || `Models failed (${res.status})`,
            baseUrl: body.base_url ?? serverUrl,
          });
          return;
        }

        const raw = body.models ?? body.data ?? [];
        const models: LlmModelOption[] = raw
          .map((m) => ({
            id: typeof m.id === "string" ? m.id : "",
            owned_by: typeof m.owned_by === "string" ? m.owned_by : undefined,
          }))
          .filter((m) => m.id.length > 0);

        setState({
          models,
          loading: false,
          error: null,
          baseUrl: body.base_url ?? serverUrl,
        });
      } catch (err) {
        if (cancelled || (err as Error).name === "AbortError") return;
        setState({
          models: [],
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load models",
          baseUrl: serverUrl,
        });
      }
    }

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [serverUrl, refreshKey]);

  return {
    ...state,
    refresh: () => setRefreshKey((k) => k + 1),
  };
}
