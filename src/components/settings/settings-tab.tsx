"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { LlmServerModelPicker } from "@/components/llm/llm-server-model-picker";
import { useLlmSettings, type LlmPreset } from "@/hooks/use-llm-settings";
import { useRagSettings } from "@/hooks/use-rag-settings";
import { DEFAULT_RAG_SETTINGS } from "@/lib/rag-settings";

export function SettingsTab() {
  const { settings, update, ready } = useRagSettings();
  const llm = useLlmSettings();
  const [savedFlash, setSavedFlash] = useState(false);
  const [llmSavedFlash, setLlmSavedFlash] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [draftPresets, setDraftPresets] = useState<LlmPreset[] | null>(null);

  const presets = draftPresets ?? llm.presets;

  function flashSaved() {
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1500);
  }

  function newPresetId() {
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `preset-${Date.now()}`;
  }

  if (!ready || !llm.ready) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>LLM servers &amp; models</CardTitle>
            <CardDescription>
              Bind to env defaults (
              <code className="rounded bg-muted px-1">LOCAL_LLM_BASE_URL</code>
              ), then override at runtime. Preset labels are free-form — never
              hardcode server IPs in source.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <LlmServerModelPicker
              baseUrl={llm.baseUrl}
              model={llm.model}
              presets={presets}
              onBaseUrlChange={(url) => llm.setLocal({ baseUrl: url })}
              onModelChange={(model) => llm.setLocal({ model })}
              onPersist={async () => {
                setLlmError(null);
                try {
                  await llm.persist({
                    baseUrl: llm.baseUrl,
                    model: llm.model,
                    presets,
                  });
                  setDraftPresets(null);
                  setLlmSavedFlash(true);
                  window.setTimeout(() => setLlmSavedFlash(false), 1500);
                } catch (err) {
                  setLlmError(
                    err instanceof Error ? err.message : "Failed to save",
                  );
                }
              }}
            />

            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between gap-2">
                <Label>Server presets</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setDraftPresets([
                      ...presets,
                      {
                        id: newPresetId(),
                        label: `Server ${presets.length + 1}`,
                        baseUrl: llm.baseUrl || llm.defaultBaseUrl,
                      },
                    ])
                  }
                >
                  <Plus className="size-3.5" />
                  Add slot
                </Button>
              </div>
              {presets.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Optional named slots (label + URL you enter). Env default:{" "}
                  {llm.envBaseUrl || llm.defaultBaseUrl}
                </p>
              )}
              {presets.map((p, idx) => (
                <div key={p.id} className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[8rem] flex-1 space-y-1">
                    <Label className="text-xs">Label</Label>
                    <Input
                      value={p.label}
                      onChange={(e) => {
                        const next = presets.map((x, i) =>
                          i === idx ? { ...x, label: e.target.value } : x,
                        );
                        setDraftPresets(next);
                      }}
                      placeholder="e.g. Office GPU"
                    />
                  </div>
                  <div className="min-w-[12rem] flex-[2] space-y-1">
                    <Label className="text-xs">Base URL</Label>
                    <Input
                      value={p.baseUrl}
                      onChange={(e) => {
                        const next = presets.map((x, i) =>
                          i === idx ? { ...x, baseUrl: e.target.value } : x,
                        );
                        setDraftPresets(next);
                      }}
                      placeholder="http://host:port/v1"
                    />
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Remove preset"
                    onClick={() =>
                      setDraftPresets(presets.filter((_, i) => i !== idx))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              Effective source: <code>{llm.source}</code>
              {llm.envModel ? ` · env model ${llm.envModel}` : ""}
            </p>
            {llmSavedFlash && (
              <p className="text-xs text-emerald-600">
                {llm.apiAvailable
                  ? "Saved to ./storage/llm-settings.json"
                  : "Saved locally (API pending) — chat still sends baseUrl/model"}
              </p>
            )}
            {llmError && <p className="text-xs text-destructive">{llmError}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Text chunking</CardTitle>
            <CardDescription>
              Applied to new uploads via multipart{" "}
              <code>chunk_size</code> / <code>chunk_overlap</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <SliderField
              label="Chunk size (characters)"
              value={settings.chunk_size}
              min={100}
              max={2000}
              step={50}
              description="Larger chunks keep more context; smaller ones improve precision."
              onChange={(v) => update({ chunk_size: v })}
            />
            <SliderField
              label="Chunk overlap (characters)"
              value={settings.chunk_overlap}
              min={0}
              max={500}
              step={10}
              description="Must stay below chunk size for continuity across boundaries."
              onChange={(v) => update({ chunk_overlap: v })}
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => flashSaved()}>Apply to new uploads</Button>
              {savedFlash && (
                <span className="self-center text-xs text-emerald-600">
                  Saved locally — used on next upload
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>RAG retrieval</CardTitle>
            <CardDescription>
              Top-K and relevance threshold shared with Chat and Vector Inspector
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <SliderField
              label="Default Top-K"
              value={settings.top_k}
              min={1}
              max={20}
              step={1}
              description="How many similar chunks to retrieve for each question."
              onChange={(v) => update({ top_k: v })}
            />
            <SliderField
              label="Relevance threshold"
              value={settings.similarity_threshold}
              min={0}
              max={1}
              step={0.05}
              format={(v) => v.toFixed(2)}
              description="min_score / similarity_threshold sent to chat and vector-inspect (scores below are excluded)."
              onChange={(v) => update({ similarity_threshold: v })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Generation preferences</CardTitle>
            <CardDescription>
              Stored locally for future LLM request options
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <SliderField
              label="Temperature"
              value={settings.temperature}
              min={0}
              max={2}
              step={0.1}
              format={(v) => v.toFixed(1)}
              onChange={(v) => update({ temperature: v })}
            />
            <SliderField
              label="Max response tokens"
              value={settings.max_tokens}
              min={100}
              max={4000}
              step={50}
              onChange={(v) => update({ max_tokens: v })}
            />
            <Button
              variant="outline"
              onClick={() => update({ ...DEFAULT_RAG_SETTINGS })}
            >
              Reset to defaults
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Storage</CardTitle>
            <CardDescription>Local-only paths (server-side)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Uploads: <code>STORAGE_PATH</code> (default{" "}
              <code>./storage/uploads</code>)
            </p>
            <p>
              Vector DB: <code>VECTORDB_PATH</code> (default{" "}
              <code>./storage/vectordb</code>)
            </p>
            <p>
              LLM settings: <code>./storage/llm-settings.json</code>
            </p>
            <p>
              Secrets stay in <code>.env.local</code> — never shipped to the
              client.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  description,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  description?: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <span className="text-sm tabular-nums font-medium">
          {format ? format(value) : value}
        </span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(v) => {
          const next = Array.isArray(v) ? v[0] : value;
          if (typeof next === "number") onChange(next);
        }}
      />
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
