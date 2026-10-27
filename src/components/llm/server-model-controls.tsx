"use client";

import { startTransition, useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLlmModels } from "@/hooks/use-llm-models";
import { useRagSettings } from "@/hooks/use-rag-settings";
import {
  LLM_SERVER_PRESETS,
  normalizeUiServerUrl,
  resolveActiveServerUrl,
  type LlmServerPresetId,
} from "@/lib/llm-servers";
import { cn } from "@/lib/utils";

type HealthState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "ok"; detail: string }
  | { status: "error"; detail: string };

const selectClassName =
  "flex h-9 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50";

export function ServerModelControls({
  variant = "settings",
  className,
  showHealthCheck = false,
}: {
  variant?: "settings" | "header";
  className?: string;
  showHealthCheck?: boolean;
}) {
  const { settings, update, ready } = useRagSettings();
  const serverUrl = resolveActiveServerUrl(settings);
  const { models, loading, error, refresh } = useLlmModels(serverUrl);
  const [health, setHealth] = useState<HealthState>({ status: "idle" });
  const [customDraft, setCustomDraft] = useState(settings.custom_server_url);

  useEffect(() => {
    setCustomDraft(settings.custom_server_url);
  }, [settings.custom_server_url]);

  // Keep selected_model in sync with the live model list for the active server.
  // startTransition + deferred broadcast in useRagSettings avoids updating
  // ChatTab while this component is still in its render/update cycle.
  useEffect(() => {
    if (loading || models.length === 0) return;
    const stillValid = models.some((m) => m.id === settings.selected_model);
    if (!stillValid) {
      const nextModel = models[0]!.id;
      startTransition(() => {
        update({ selected_model: nextModel });
      });
    }
  }, [loading, models, settings.selected_model, update]);

  function onPresetChange(preset: LlmServerPresetId) {
    setHealth({ status: "idle" });
    update({
      server_preset: preset,
      selected_model: "",
    });
  }

  function commitCustomUrl(raw: string) {
    const normalized = normalizeUiServerUrl(raw);
    setCustomDraft(normalized);
    setHealth({ status: "idle" });
    update({
      custom_server_url: normalized,
      selected_model: "",
    });
  }

  async function runHealthCheck() {
    setHealth({ status: "checking" });
    try {
      const qs = new URLSearchParams({ server_url: serverUrl });
      const res = await fetch(`/api/llm/health?${qs.toString()}`);
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        base_url?: string;
        model_count?: number;
        error?: string;
        message?: string;
      };
      if (body.ok) {
        setHealth({
          status: "ok",
          detail: `${body.base_url || serverUrl} · ${body.model_count ?? "?"} models`,
        });
      } else {
        setHealth({
          status: "error",
          detail: body.error || body.message || "Health check failed",
        });
      }
    } catch (err) {
      setHealth({
        status: "error",
        detail: err instanceof Error ? err.message : "Health check failed",
      });
    }
  }

  if (!ready) {
    return (
      <div className={cn("flex items-center gap-2 text-muted-foreground", className)}>
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  const isHeader = variant === "header";
  const idPrefix = isHeader ? "chat" : "settings";

  return (
    <div
      className={cn(
        isHeader ? "flex flex-wrap items-end gap-2" : "flex flex-col gap-4",
        className,
      )}
    >
      <div className={cn(isHeader ? "min-w-[9.5rem] flex-1 space-y-1" : "space-y-2")}>
        {!isHeader && <Label htmlFor={`${idPrefix}-llm-server-preset`}>Server</Label>}
        {isHeader && (
          <span className="text-[11px] font-medium text-muted-foreground">Server</span>
        )}
        <select
          id={`${idPrefix}-llm-server-preset`}
          value={settings.server_preset}
          onChange={(e) => onPresetChange(e.target.value as LlmServerPresetId)}
          className={selectClassName}
          aria-label="LLM server"
        >
          {LLM_SERVER_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {settings.server_preset === "custom" && (
        <div className={cn(isHeader ? "min-w-[12rem] flex-[1.4] space-y-1" : "space-y-2")}>
          {!isHeader && (
            <Label htmlFor={`${idPrefix}-llm-custom-url`}>Custom Base URL</Label>
          )}
          {isHeader && (
            <span className="text-[11px] font-medium text-muted-foreground">
              Custom URL
            </span>
          )}
          <Input
            id={`${idPrefix}-llm-custom-url`}
            value={customDraft}
            placeholder="http://192.168.0.201:11434"
            onChange={(e) => setCustomDraft(e.target.value)}
            onBlur={() => commitCustomUrl(customDraft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitCustomUrl(customDraft);
              }
            }}
            className={isHeader ? "h-9" : undefined}
          />
          {!isHeader && (
            <p className="text-xs text-muted-foreground">
              No <code>/v1</code> suffix — host only (e.g.{" "}
              <code>http://192.168.0.201:11434</code>).
            </p>
          )}
        </div>
      )}

      <div className={cn(isHeader ? "min-w-[10rem] flex-[1.2] space-y-1" : "space-y-2")}>
        {!isHeader && <Label htmlFor={`${idPrefix}-llm-model`}>Model</Label>}
        {isHeader && (
          <span className="text-[11px] font-medium text-muted-foreground">Model</span>
        )}
        <div className="flex gap-2">
          <select
            id={`${idPrefix}-llm-model`}
            value={settings.selected_model}
            onChange={(e) => update({ selected_model: e.target.value })}
            disabled={loading || models.length === 0}
            className={cn(selectClassName, "flex-1")}
            aria-label="LLM model"
          >
            {loading && <option value="">Loading models…</option>}
            {!loading && models.length === 0 && (
              <option value="">No models found</option>
            )}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
          {!isHeader && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              title="Refresh models"
              aria-label="Refresh models"
              onClick={() => refresh()}
            >
              {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            </Button>
          )}
        </div>
        {!isHeader && error && (
          <p className="text-xs text-destructive">{error}</p>
        )}
        {!isHeader && !error && (
          <p className="text-xs text-muted-foreground">
            Active: <code>{serverUrl}</code>
            {settings.selected_model ? (
              <>
                {" "}
                · model <code>{settings.selected_model}</code>
              </>
            ) : null}
          </p>
        )}
      </div>

      {showHealthCheck && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void runHealthCheck()}
            disabled={health.status === "checking"}
          >
            {health.status === "checking" ? (
              <Loader2 className="animate-spin" />
            ) : null}
            Health Check
          </Button>
          {health.status === "ok" && (
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
              <CheckCircle2 /> {health.detail}
            </Badge>
          )}
          {health.status === "error" && (
            <Badge variant="destructive">
              <CircleAlert /> {health.detail}
            </Badge>
          )}
        </div>
      )}

      {isHeader && (loading || error) && (
        <div className="flex items-center gap-1 self-end pb-1 text-[11px] text-muted-foreground">
          {loading && <Loader2 className="size-3 animate-spin" />}
          {error && <span className="text-destructive">{error}</span>}
        </div>
      )}
    </div>
  );
}
