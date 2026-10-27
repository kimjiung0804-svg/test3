"use client";

import { useCallback, useEffect, useState } from "react";
import type { CitationData } from "@/lib/types";

export type ChatSessionSummary = {
  id: string;
  title: string;
  updatedAt: string;
};

export type ChatSessionMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations?: CitationData[];
  created_at?: string;
};

export type ChatSession = ChatSessionSummary & {
  messages: ChatSessionMessage[];
};

const LOCAL_KEY = "rag-doc-chat-sessions-v1";

function loadLocal(): ChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocal(sessions: ChatSession[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LOCAL_KEY, JSON.stringify(sessions));
}

function titleFromMessage(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 48 ? `${t.slice(0, 48)}…` : t || "New chat";
}

function normalizeSummary(raw: Record<string, unknown>): ChatSessionSummary | null {
  const id = typeof raw.id === "string" ? raw.id : null;
  if (!id) return null;
  const title =
    typeof raw.title === "string" && raw.title.trim()
      ? raw.title
      : "New chat";
  const updatedAt =
    (typeof raw.updatedAt === "string" && raw.updatedAt) ||
    (typeof raw.updated_at === "string" && raw.updated_at) ||
    new Date().toISOString();
  return { id, title, updatedAt };
}

export function useChatSessions() {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatSessionMessage[]>([]);
  const [ready, setReady] = useState(false);
  const [apiAvailable, setApiAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    try {
      const res = await fetch("/api/chats");
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data.sessions)
          ? data.sessions
          : Array.isArray(data)
            ? data
            : [];
        const summaries = list
          .map((s: Record<string, unknown>) => normalizeSummary(s))
          .filter(Boolean) as ChatSessionSummary[];
        summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        setSessions(summaries);
        setApiAvailable(true);
        setError(null);
        return summaries;
      }
      if (res.status === 404) {
        setApiAvailable(false);
        const local = loadLocal();
        const summaries = local
          .map((s) => ({
            id: s.id,
            title: s.title,
            updatedAt: s.updatedAt,
          }))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        setSessions(summaries);
        return summaries;
      }
      setApiAvailable(false);
      const local = loadLocal();
      setSessions(
        local
          .map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt }))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      );
    } catch {
      setApiAvailable(false);
      const local = loadLocal();
      setSessions(
        local
          .map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt }))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      );
    }
    return null;
  }, []);

  useEffect(() => {
    void (async () => {
      await refreshList();
      setReady(true);
    })();
  }, [refreshList]);

  const selectSession = useCallback(
    async (id: string | null) => {
      setActiveId(id);
      setError(null);
      if (!id) {
        setMessages([]);
        return;
      }
      if (apiAvailable) {
        try {
          const res = await fetch(`/api/chats/${id}`);
          if (res.ok) {
            const data = await res.json();
            const msgs = Array.isArray(data.messages) ? data.messages : [];
            setMessages(
              msgs.map((m: ChatSessionMessage, i: number) => ({
                id: m.id || `m-${i}`,
                role: m.role,
                content: m.content,
                citations: m.citations,
                created_at: m.created_at,
              })),
            );
            return;
          }
        } catch {
          /* fall through to local */
        }
      }
      const local = loadLocal().find((s) => s.id === id);
      setMessages(local?.messages ?? []);
    },
    [apiAvailable],
  );

  const createSession = useCallback(async () => {
    setError(null);
    if (apiAvailable) {
      try {
        const res = await fetch("/api/chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "New chat" }),
        });
        if (res.ok) {
          const data = await res.json();
          const summary = normalizeSummary(data as Record<string, unknown>);
          if (summary) {
            setSessions((prev) => [summary, ...prev.filter((s) => s.id !== summary.id)]);
            setActiveId(summary.id);
            setMessages([]);
            return summary.id;
          }
        }
      } catch {
        /* local fallback */
      }
    }
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `local-${Date.now()}`;
    const session: ChatSession = {
      id,
      title: "New chat",
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    const next = [session, ...loadLocal().filter((s) => s.id !== id)];
    saveLocal(next);
    setSessions(
      next.map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt })),
    );
    setActiveId(id);
    setMessages([]);
    return id;
  }, [apiAvailable]);

  const deleteSession = useCallback(
    async (id: string) => {
      if (apiAvailable) {
        try {
          await fetch(`/api/chats/${id}`, { method: "DELETE" });
        } catch {
          /* ignore */
        }
      }
      const next = loadLocal().filter((s) => s.id !== id);
      saveLocal(next);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
      }
      await refreshList();
    },
    [activeId, apiAvailable, refreshList],
  );

  const ensureSession = useCallback(async () => {
    if (activeId) return activeId;
    return createSession();
  }, [activeId, createSession]);

  const recordTurn = useCallback(
    async (params: {
      sessionId: string;
      userContent: string;
      assistantContent: string;
      citations?: CitationData[];
    }) => {
      const now = new Date().toISOString();
      const userMsg: ChatSessionMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content: params.userContent,
        created_at: now,
      };
      const assistantMsg: ChatSessionMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: params.assistantContent,
        citations: params.citations,
        created_at: now,
      };

      const title = titleFromMessage(params.userContent);

      if (apiAvailable) {
        try {
          await fetch(`/api/chats/${params.sessionId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: [
                { role: "user", content: params.userContent },
                {
                  role: "assistant",
                  content: params.assistantContent,
                  citations: params.citations,
                },
              ],
            }),
          }).catch(() => undefined);
          await fetch(`/api/chats/${params.sessionId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title }),
          }).catch(() => undefined);
        } catch {
          /* local mirror below */
        }
      }

      const local = loadLocal();
      const existing = local.find((s) => s.id === params.sessionId);
      const updated: ChatSession = {
        id: params.sessionId,
        title: existing?.title === "New chat" || !existing ? title : existing.title,
        updatedAt: now,
        messages: [...(existing?.messages ?? []), userMsg, assistantMsg],
      };
      saveLocal([updated, ...local.filter((s) => s.id !== params.sessionId)]);
      setSessions((prev) => {
        const rest = prev.filter((s) => s.id !== params.sessionId);
        return [
          { id: updated.id, title: updated.title, updatedAt: updated.updatedAt },
          ...rest,
        ];
      });
    },
    [apiAvailable],
  );

  return {
    sessions,
    activeId,
    messages,
    setMessages,
    ready,
    apiAvailable,
    error,
    refreshList,
    selectSession,
    createSession,
    deleteSession,
    ensureSession,
    recordTurn,
    setActiveId,
  };
}
