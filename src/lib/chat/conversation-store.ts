import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { ensureStorageDirs } from "@/lib/storage";
import type { ChatMessage, CitationData } from "@/lib/types";

const CONV_DIR = "conversations";

async function conversationsRoot(): Promise<string> {
  const { storagePath } = await ensureStorageDirs();
  const root = path.join(storagePath, CONV_DIR);
  await mkdir(root, { recursive: true });
  return root;
}

function conversationFile(root: string, conversationId: string) {
  return path.join(root, `${conversationId}.json`);
}

interface ConversationRecord {
  id: string;
  messages: ChatMessage[];
  updated_at: string;
}

async function readConversation(
  conversationId: string,
): Promise<ConversationRecord | null> {
  const root = await conversationsRoot();
  try {
    const raw = await readFile(
      conversationFile(root, conversationId),
      "utf-8",
    );
    return JSON.parse(raw) as ConversationRecord;
  } catch {
    return null;
  }
}

async function writeConversation(record: ConversationRecord): Promise<void> {
  const root = await conversationsRoot();
  await writeFile(
    conversationFile(root, record.id),
    JSON.stringify(record, null, 2),
    "utf-8",
  );
}

export async function appendChatTurn(params: {
  conversationId?: string;
  userContent: string;
  assistantContent: string;
  citations: CitationData[];
}): Promise<{ conversation_id: string; user: ChatMessage; assistant: ChatMessage }> {
  const conversationId = params.conversationId?.trim() || randomUUID();
  const existing = await readConversation(conversationId);
  const now = new Date().toISOString();

  const user: ChatMessage = {
    id: randomUUID(),
    conversation_id: conversationId,
    role: "user",
    content: params.userContent,
    created_at: now,
  };

  const assistant: ChatMessage = {
    id: randomUUID(),
    conversation_id: conversationId,
    role: "assistant",
    content: params.assistantContent,
    citations: params.citations,
    created_at: now,
  };

  const record: ConversationRecord = {
    id: conversationId,
    messages: [...(existing?.messages ?? []), user, assistant],
    updated_at: now,
  };
  await writeConversation(record);

  return { conversation_id: conversationId, user, assistant };
}
