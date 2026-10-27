"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Wifi } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  fetchLlmModelsList,
  probeLlmHealthCheck,
  type LlmPreset,
} from "@/hooks/use-llm-settings";
import { cn } from "@/lib/utils";

type Props = {
  baseUrl: string;
  model: string;
  presets: LlmPreset[];
  compact?: boolean;
  className?: string;
  onBaseUrlChange: (url: string) => void;
  onModelChange: (model: string) => void;
  onPersist?: () => Promise<void> | void;
};

export function LlmServerModelPicker({
  baseUrl,
  model,
  presets,
  compact = false,
  className,
  onBaseUrlChange,
  onModelChange,
  onPersist,
}: Props) {
  const [models, setModels] = useState<Array<{ id: string }>>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [health, setHealth] = useState<"idle" | "checking" | "ok" | "fail">("idle");
  const [healthDetail, setHealthDetail] = useState("");
  const [saving, setSaving] = useState(false);

  async function refreshModels(url = baseUrl) {
    setLoadingModels(true);
    setModelsError(null);
    const result = await fetchLlmModelsList(url);
    setModels(result.models);
    if (result.error) setModelsError(result.error);
    if (
      result.models.length > 0 &&
      model &&
      !result.models.some((m) => m.id === model)
    ) {
      /* keep custom model id typed by user */
    } else if (!model && result.models[0]) {
      onModelChange(result.models[0].id);
    }
    setLoadingModels(false);
  }

  useEffect(() => {
    if (!baseUrl.trim()) return;
    const t = window.setTimeout(() => void refreshModels(baseUrl), 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl]);

  async function runHealth() {
    setHealth("checking");
    const result = await probeLlmHealthCheck(baseUrl);
    if (result.ok) {
      setHealth("ok");
      setHealthDetail(
        `${result.latency_ms ?? "?"}ms` +
          (result.model_count != null ? ` · ${result.model_count} models` : ""),
      );
      void refreshModels(baseUrl);
    } else {
      setHealth("fail");
      setHealthDetail(result.error || "Unreachable");
    }
  }

  async function handleSave() {
    if (!onPersist) return;
    setSaving(true);
    try {
      await onPersist();
    } finally {
      setSaving(false);
    }
  }

  const selectClass =
    "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        className={cn(
          "grid gap-2",
          compact ? "grid-cols-1 sm:grid-cols-[1fr_1fr_auto]" : "grid-cols-1",
        )}
      >
        <div className="min-w-0 space-y-1">
          {!compact && <Label className="text-xs">LLM server</Label>}
          <div className="flex gap-1.5">
            {presets.length > 0 && (
              <select
                aria-label="Server preset"
                className={cn(selectClass, "max-w-[40%] shrink-0")}
                value={
                  presets.find((p) => p.baseUrl === baseUrl)?.id ?? "__custom__"
                }
                onChange={(e) => {
                  const id = e.target.value;
                  if (id === "__custom__") return;
                  const preset = presets.find((p) => p.id === id);
                  if (preset) onBaseUrlChange(preset.baseUrl);
                }}
              >
                <option value="__custom__">Custom</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
            <input
              aria-label="LLM server URL"
              className={selectClass}
              value={baseUrl}
              placeholder="http://localhost:11434/v1"
              onChange={(e) => onBaseUrlChange(e.target.value)}
            />
          </div>
        </div>

        <div className="min-w-0 space-y-1">
          {!compact && <Label className="text-xs">Model</Label>}
          <div className="flex gap-1.5">
            <select
              aria-label="LLM model"
              className={selectClass}
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              disabled={loadingModels && models.length === 0}
            >
              {model && !models.some((m) => m.id === model) && (
                <option value={model}>{model}</option>
              )}
              {!model && <option value="">Select model…</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              onClick={() => void refreshModels()}
              disabled={loadingModels || !baseUrl.trim()}
              aria-label="Refresh models"
            >
              {loadingModels ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
            </Button>
          </div>
        </div>

        <div className={cn("flex flex-wrap items-end gap-1.5", !compact && "pt-5")}>
          <Button
            type="button"
            size={compact ? "sm" : "default"}
            variant="outline"
            onClick={() => void runHealth()}
            disabled={!baseUrl.trim() || health === "checking"}
          >
            {health === "checking" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Wifi className="size-3.5" />
            )}
            Health
          </Button>
          {onPersist && (
            <Button
              type="button"
              size={compact ? "sm" : "default"}
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Save
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {health === "ok" && (
          <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
            OK {healthDetail}
          </Badge>
        )}
        {health === "fail" && (
          <Badge variant="destructive">Fail · {healthDetail}</Badge>
        )}
        {modelsError && <span className="text-destructive">{modelsError}</span>}
        {!modelsError && models.length > 0 && (
          <span>{models.length} model{models.length === 1 ? "" : "s"} loaded</span>
        )}
      </div>
    </div>
  );
}
