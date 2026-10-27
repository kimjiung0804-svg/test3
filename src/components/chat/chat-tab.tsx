"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, SendHorizontal, Sparkles } from "lucide-react";
import { ServerModelControls } from "@/components/llm/server-model-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useRagSettings } from "@/hooks/use-rag-settings";
import { resolveActiveServerUrl } from "@/lib/llm-servers";
import type { CitationData, ChatStreamEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: CitationData[];
  streaming?: boolean;
  error?: string;
};

const FILE_COLORS = [
  "bg-sky-100 text-sky-800 border-sky-200",
  "bg-emerald-100 text-emerald-800 border-emerald-200",
  "bg-amber-100 text-amber-800 border-amber-200",
  "bg-rose-100 text-rose-800 border-rose-200",
  "bg-violet-100 text-violet-800 border-violet-200",
];

function colorForFile(fileId: string): string {
  let hash = 0;
  for (let i = 0; i < fileId.length; i++) hash = (hash + fileId.charCodeAt(i)) % FILE_COLORS.length;
  return FILE_COLORS[hash]!;
}

function renderMarkdownLite(text: string) {
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("```") && part.endsWith("```")) {
      const code = part.slice(3, -3).replace(/^\w+\n/, "");
      return (
        <pre
          key={i}
          className="my-2 overflow-x-auto rounded-lg bg-zinc-900 p-3 text-xs text-zinc-100"
        >
          <code>{code}</code>
        </pre>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

export function ChatTab() {
  const { settings } = useRagSettings();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [citation, setCitation] = useState<CitationData | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: UiMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
    };
    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: "assistant", content: "", streaming: true },
    ]);
    setInput("");
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversation_id: conversationId,
          top_k: settings.top_k,
          similarity_threshold: settings.similarity_threshold,
          temperature: settings.temperature,
          server_url: resolveActiveServerUrl(settings),
          selected_model: settings.selected_model,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  streaming: false,
                  error: err.message || `Chat failed (${res.status})`,
                  content: err.message || `Chat failed (${res.status})`,
                }
              : m,
          ),
        );
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let citations: CitationData[] = [];
      let content = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let event: ChatStreamEvent;
          try {
            event = JSON.parse(payload) as ChatStreamEvent;
          } catch {
            continue;
          }

          if (event.type === "citations") {
            citations = event.citations;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, citations } : m,
              ),
            );
          } else if (event.type === "chunk") {
            content += event.content;
            const snapshot = content;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: snapshot, citations, streaming: true }
                  : m,
              ),
            );
          } else if (event.type === "done") {
            setConversationId(event.conversation_id);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, streaming: false, citations, content }
                  : m,
              ),
            );
          } else if (event.type === "error") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      streaming: false,
                      error: event.message,
                      content: content || event.message,
                      citations,
                    }
                  : m,
              ),
            );
          }
        }
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, streaming: false } : m,
        ),
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const message = err instanceof Error ? err.message : "Chat failed";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, streaming: false, error: message, content: message }
            : m,
        ),
      );
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b bg-background/95 px-3 py-2 backdrop-blur sm:px-4">
        <div className="mx-auto w-full max-w-3xl">
          <ServerModelControls variant="header" />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-1">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
                <Sparkles className="size-6" />
              </div>
              <div>
                <p className="text-base font-medium text-foreground">Ask your documents</p>
                <p className="mt-1 text-sm">
                  Upload files in File Manager, then ask questions with streaming answers and source badges.
                  Switch server/model anytime from the header above.
                </p>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex w-full",
                msg.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm",
                  msg.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-muted/80 text-foreground ring-1 ring-border",
                  msg.error && msg.role === "assistant" && "ring-destructive/40",
                )}
              >
                <div className="whitespace-pre-wrap break-words">
                  {msg.role === "assistant"
                    ? renderMarkdownLite(msg.content || (msg.streaming ? "…" : ""))
                    : msg.content}
                  {msg.streaming && (
                    <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-foreground/70 align-middle" />
                  )}
                </div>

                {msg.citations && msg.citations.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-2">
                    {msg.citations.map((c) => (
                      <button
                        key={c.chunk_id}
                        type="button"
                        title={c.content_preview?.slice(0, 150) || c.filename}
                        onClick={() => setCitation(c)}
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium transition hover:opacity-80",
                          colorForFile(c.file_id),
                        )}
                      >
                        {c.filename}
                        {c.page_number != null ? ` · p.${c.page_number}` : ""}
                        {typeof c.similarity_score === "number"
                          ? ` · ${(c.similarity_score * 100).toFixed(0)}%`
                          : ""}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className="border-t bg-background/95 p-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question about your documents…"
            rows={1}
            disabled={streaming}
            className="min-h-11 max-h-40 flex-1 resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
          />
          <Button
            size="icon-lg"
            disabled={!input.trim() || streaming}
            onClick={() => void sendMessage()}
            aria-label="Send"
          >
            {streaming ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
          </Button>
        </div>
        <p className="mx-auto mt-1.5 max-w-3xl px-1 text-[11px] text-muted-foreground">
          Enter to send · Shift+Enter for newline · Top-K {settings.top_k}
          {settings.selected_model
            ? ` · ${settings.selected_model}`
            : ""}
        </p>
      </div>

      <Dialog open={!!citation} onOpenChange={(open) => !open && setCitation(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{citation?.filename}</DialogTitle>
            <DialogDescription>
              {citation?.page_number != null ? `Page ${citation.page_number} · ` : ""}
              Similarity{" "}
              {citation ? `${(citation.similarity_score * 100).toFixed(1)}%` : "—"}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto rounded-lg bg-muted/50 p-3 text-sm leading-relaxed whitespace-pre-wrap">
            {citation?.content_preview || "No preview available for this chunk."}
          </div>
          {citation && (
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">chunk {citation.chunk_id.slice(0, 8)}</Badge>
              <Badge variant="secondary">file {citation.file_id.slice(0, 8)}</Badge>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
