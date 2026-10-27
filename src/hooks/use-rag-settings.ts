"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_RAG_SETTINGS,
  loadRagSettings,
  saveRagSettings,
  type RagSettings,
} from "@/lib/rag-settings";

function applyPatch(prev: RagSettings, patch: Partial<RagSettings>): RagSettings {
  const next = { ...prev, ...patch };
  if (next.chunk_overlap >= next.chunk_size) {
    next.chunk_overlap = Math.max(0, next.chunk_size - 10);
  }
  return next;
}

export function useRagSettings() {
  const [settings, setSettings] = useState<RagSettings>(DEFAULT_RAG_SETTINGS);
  const [ready, setReady] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    setSettings(loadRagSettings());
    setReady(true);

    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<RagSettings>).detail;
      const next = detail ?? loadRagSettings();
      // Defer so a sync CustomEvent from another component's update never
      // calls setState while React is still rendering that component.
      queueMicrotask(() => {
        startTransition(() => {
          setSettings(next);
        });
      });
    };

    window.addEventListener("rag-settings-changed", onChange);
    return () => window.removeEventListener("rag-settings-changed", onChange);
  }, []);

  const update = useCallback((patch: Partial<RagSettings>) => {
    const next = applyPatch(settingsRef.current, patch);
    settingsRef.current = next;
    // Keep local state and persist/broadcast outside any setState updater /
    // render path so peer hooks (e.g. ChatTab) are not updated mid-render.
    startTransition(() => {
      setSettings(next);
    });
    queueMicrotask(() => {
      saveRagSettings(next);
    });
  }, []);

  return { settings, update, ready };
}
