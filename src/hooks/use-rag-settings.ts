"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_RAG_SETTINGS,
  loadRagSettings,
  saveRagSettings,
  type RagSettings,
} from "@/lib/rag-settings";

export function useRagSettings() {
  const [settings, setSettings] = useState<RagSettings>(DEFAULT_RAG_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSettings(loadRagSettings());
    setReady(true);
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<RagSettings>).detail;
      if (detail) setSettings(detail);
      else setSettings(loadRagSettings());
    };
    window.addEventListener("rag-settings-changed", onChange);
    return () => window.removeEventListener("rag-settings-changed", onChange);
  }, []);

  const update = useCallback((patch: Partial<RagSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      if (next.chunk_overlap >= next.chunk_size) {
        next.chunk_overlap = Math.max(0, next.chunk_size - 10);
      }
      saveRagSettings(next);
      return next;
    });
  }, []);

  return { settings, update, ready };
}
