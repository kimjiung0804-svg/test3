"use client";

import {
  Database,
  FolderOpen,
  MessageSquare,
  Settings,
} from "lucide-react";
import { ChatTab } from "@/components/chat/chat-tab";
import { FilesTab } from "@/components/files/files-tab";
import { SettingsTab } from "@/components/settings/settings-tab";
import { VectorTab } from "@/components/vector/vector-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";

const TABS = [
  { value: "chat", label: "Chat", icon: MessageSquare, short: "Chat" },
  { value: "files", label: "Files", icon: FolderOpen, short: "Files" },
  { value: "vector", label: "Vectors", icon: Database, short: "Vectors" },
  { value: "settings", label: "Settings", icon: Settings, short: "Settings" },
] as const;

export function RagApp() {
  return (
    <TooltipProvider>
      <div className="flex h-dvh min-h-0 flex-col bg-background">
        <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">
              Local Document RAG
            </p>
            <p className="truncate text-xs text-muted-foreground">
              Chat · files · vector inspect · settings
            </p>
          </div>
          <BadgeLocal />
        </header>

        <Tabs defaultValue="chat" className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="border-b px-2 pt-2 sm:px-4">
            <TabsList className="grid h-auto w-full grid-cols-4 gap-1 sm:inline-flex sm:w-auto">
              {TABS.map(({ value, label, icon: Icon, short }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="gap-1.5 px-2 py-1.5 sm:px-3"
                >
                  <Icon className="size-4" />
                  <span className="hidden sm:inline">{label}</span>
                  <span className="sm:hidden">{short}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="chat" className="min-h-0 flex-1 overflow-hidden p-0 data-[hidden]:hidden">
            <ChatTab />
          </TabsContent>
          <TabsContent value="files" className="min-h-0 flex-1 overflow-hidden p-0 data-[hidden]:hidden">
            <FilesTab />
          </TabsContent>
          <TabsContent value="vector" className="min-h-0 flex-1 overflow-hidden p-0 data-[hidden]:hidden">
            <VectorTab />
          </TabsContent>
          <TabsContent value="settings" className="min-h-0 flex-1 overflow-hidden p-0 data-[hidden]:hidden">
            <SettingsTab />
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}

function BadgeLocal() {
  return (
    <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-800">
      100% local
    </span>
  );
}
