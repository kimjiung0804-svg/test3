"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Loader2, Wifi } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useRagSettings } from "@/hooks/use-rag-settings";
import { DEFAULT_RAG_SETTINGS } from "@/lib/rag-settings";

type LlmStatus = "checking" | "ready" | "missing" | "error";

export function SettingsTab() {
  const { settings, update, ready } = useRagSettings();
  const [llmStatus, setLlmStatus] = useState<LlmStatus>("checking");
  const [llmDetail, setLlmDetail] = useState("Checking API routes…");
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function probe() {
      try {
        const filesRes = await fetch("/api/files?limit=1");
        if (!filesRes.ok) {
          if (!cancelled) {
            setLlmStatus("error");
            setLlmDetail("Backend API not reachable");
          }
          return;
        }

        const chatRes = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "" }),
        });
        const body = await chatRes.json().catch(() => ({}));

        if (cancelled) return;

        if (chatRes.status === 404) {
          setLlmStatus("missing");
          setLlmDetail("/api/chat not deployed yet — UI is bound and ready");
          return;
        }

        if (
          body.error === "llm_not_configured" ||
          chatRes.status === 503
        ) {
          setLlmStatus("error");
          setLlmDetail(
            body.message ||
              "Set LOCAL_LLM_BASE_URL in .env.local (OpenAI-compatible endpoint)",
          );
          return;
        }

        // empty message → invalid_request means route is live
        if (body.error === "invalid_request" || chatRes.status === 400) {
          setLlmStatus("ready");
          setLlmDetail("Chat API reachable · LLM via LOCAL_LLM_BASE_URL");
          return;
        }

        setLlmStatus("ready");
        setLlmDetail("Chat API reachable");
      } catch {
        if (!cancelled) {
          setLlmStatus("error");
          setLlmDetail("Could not reach local APIs");
        }
      }
    }
    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

  function flashSaved() {
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1500);
  }

  if (!ready) {
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
            <CardTitle>LLM connection</CardTitle>
            <CardDescription>
              Local OpenAI-compatible endpoint from{" "}
              <code className="rounded bg-muted px-1">.env.local</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Wifi className="size-4 text-muted-foreground" />
              {llmStatus === "checking" && (
                <Badge variant="outline">
                  <Loader2 className="animate-spin" /> Checking
                </Badge>
              )}
              {llmStatus === "ready" && (
                <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                  <CheckCircle2 /> Connected
                </Badge>
              )}
              {llmStatus === "missing" && (
                <Badge variant="secondary">
                  <CircleAlert /> Pending API
                </Badge>
              )}
              {llmStatus === "error" && (
                <Badge variant="destructive">
                  <CircleAlert /> Attention
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{llmDetail}</p>
            <p className="w-full text-xs text-muted-foreground">
              Base URL is server-side only (
              <code>LOCAL_LLM_BASE_URL</code>) — not exposed to the browser.
            </p>
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
              <Button
                onClick={() => {
                  flashSaved();
                }}
              >
                Apply to new uploads
              </Button>
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
              Default Top-K for chat and vector search
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
              label="Similarity threshold"
              value={settings.similarity_threshold}
              min={0}
              max={1}
              step={0.05}
              format={(v) => v.toFixed(2)}
              description="UI preference for stricter relevance filtering."
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
            <p>Secrets stay in <code>.env.local</code> — never shipped to the client.</p>
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
