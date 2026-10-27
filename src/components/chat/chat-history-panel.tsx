"use client";

import { Loader2, MessageSquarePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatRelativeTime } from "@/lib/rag-settings";
import { cn } from "@/lib/utils";

export type ChatSessionSummary = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
};

type ChatHistoryPanelProps = {
  sessions: ChatSessionSummary[];
  activeId: string | undefined;
  loading?: boolean;
  creating?: boolean;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
  className?: string;
};

export function ChatHistoryPanel({
  sessions,
  activeId,
  loading,
  creating,
  onSelect,
  onNewChat,
  onDelete,
  className,
}: ChatHistoryPanelProps) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-muted/30", className)}>
      <div className="flex items-center gap-2 border-b p-3">
        <Button
          className="w-full justify-start gap-2"
          variant="secondary"
          disabled={creating}
          onClick={onNewChat}
        >
          {creating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <MessageSquarePlus className="size-4" />
          )}
          New chat
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 p-2">
          {loading && sessions.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Loading history…
            </div>
          )}

          {!loading && sessions.length === 0 && (
            <p className="px-2 py-8 text-center text-xs text-muted-foreground">
              No conversations yet. Start a new chat.
            </p>
          )}

          {sessions.map((session) => {
            const selected = session.id === activeId;
            return (
              <div
                key={session.id}
                className={cn(
                  "group flex items-start gap-1 rounded-lg transition",
                  selected
                    ? "bg-background shadow-sm ring-1 ring-border"
                    : "hover:bg-background/70",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(session.id)}
                  className="min-w-0 flex-1 px-2.5 py-2 text-left"
                >
                  <p
                    className={cn(
                      "truncate text-sm leading-snug",
                      selected ? "font-medium text-foreground" : "text-foreground/90",
                    )}
                  >
                    {session.title || "New chat"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatRelativeTime(session.updated_at)}
                    {session.message_count > 0
                      ? ` · ${session.message_count} msg`
                      : ""}
                  </p>
                </button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="mt-1.5 mr-1 shrink-0 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={`Delete ${session.title || "chat"}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(session.id);
                  }}
                >
                  <Trash2 className="size-3.5 text-muted-foreground" />
                </Button>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
