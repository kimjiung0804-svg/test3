"use client";

import { MessageSquarePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ChatSessionSummary } from "@/hooks/use-chat-sessions";
import { formatRelativeTime } from "@/lib/rag-settings";
import { cn } from "@/lib/utils";

type Props = {
  sessions: ChatSessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  className?: string;
};

export function ChatHistorySidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
  className,
}: Props) {
  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-full flex-col border-r bg-muted/20",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b p-2">
        <Button className="w-full justify-start gap-2" size="sm" onClick={onNew}>
          <MessageSquarePlus className="size-4" />
          New chat
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ul className="flex flex-col gap-0.5 p-1.5">
          {sessions.length === 0 && (
            <li className="px-2 py-6 text-center text-xs text-muted-foreground">
              No conversations yet
            </li>
          )}
          {sessions.map((s) => (
            <li key={s.id}>
              <div
                className={cn(
                  "group flex items-start gap-1 rounded-lg px-2 py-1.5 transition",
                  activeId === s.id
                    ? "bg-background shadow-sm ring-1 ring-border"
                    : "hover:bg-muted/60",
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onSelect(s.id)}
                >
                  <p className="truncate text-sm font-medium leading-snug">
                    {s.title || "New chat"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatRelativeTime(s.updatedAt)}
                  </p>
                </button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  className="opacity-0 transition group-hover:opacity-100"
                  aria-label="Delete chat"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s.id);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </aside>
  );
}
