import { mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import type { ChatMessage, ChatSession, CitationData } from "@/lib/types";

const DEFAULT_TITLE = "New chat";
const TITLE_MAX_LEN = 60;

/** Resolve chat session storage path from env (default ./storage/chats). */
export function getChatsPath(): string {
  return path.resolve(
    process.env.CHATS_PATH ??
      process.env.CHAT_STORAGE_PATH ??
      path.join(".", "storage", "chats"),
  );
}

export async function ensureChatsDir(): Promise<string> {
  const root = getChatsPath();
  await mkdir(root, { recursive: true });
  return root;
}

function chatFile(root: string, chatId: string) {
  return path.join(root, `${chatId}.json`);
}

function titleFromContent(content: string): string {
  const trimmed = content.replace(/\s+/g, " ").trim();
  if (!trimmed) return DEFAULT_TITLE;
  if (trimmed.length <= TITLE_MAX_LEN) return trimmed;
  return `${trimmed.slice(0, TITLE_MAX_LEN - 1).trimEnd()}…`;
}

async function readChatRecord(chatId: string): Promise<ChatSession | null> {
  const root = await ensureChatsDir();
  try {
    const raw = await readFile(chatFile(root, chatId), "utf-8");
    const parsed = JSON.parse(raw) as ChatSession;
    if (!parsed?.id) return null;
    return {
      id: parsed.id,
      title: parsed.title || DEFAULT_TITLE,
      created_at: parsed.created_at,
      updated_at: parsed.updated_at,
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

async function writeChatRecord(record: ChatSession): Promise<void> {
  const root = await ensureChatsDir();
  await writeFile(
    chatFile(root, record.id),
    JSON.stringify(record, null, 2),
    "utf-8",
  );
}

export type ChatSessionSummary = Pick<
  ChatSession,
  "id" | "title" | "created_at" | "updated_at"
> & { message_count: number };

export async function listChats(): Promise<ChatSessionSummary[]> {
  const root = await ensureChatsDir();
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }

  const sessions: ChatSessionSummary[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -".json".length);
    const record = await readChatRecord(id);
    if (!record) continue;
    sessions.push({
      id: record.id,
      title: record.title,
      created_at: record.created_at,
      updated_at: record.updated_at,
      message_count: record.messages.length,
    });
  }

  sessions.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return sessions;
}

export async function createChat(params?: {
  title?: string;
}): Promise<ChatSession> {
  const now = new Date().toISOString();
  const title =
    typeof params?.title === "string" && params.title.trim()
      ? params.title.trim()
      : DEFAULT_TITLE;

  const record: ChatSession = {
    id: randomUUID(),
    title,
    created_at: now,
    updated_at: now,
    messages: [],
  };
  await writeChatRecord(record);
  return record;
}

export async function getChat(chatId: string): Promise<ChatSession | null> {
  return readChatRecord(chatId);
}

export async function updateChat(
  chatId: string,
  patch: { title?: string },
): Promise<ChatSession | null> {
  const existing = await readChatRecord(chatId);
  if (!existing) return null;

  const nextTitle =
    typeof patch.title === "string" && patch.title.trim()
      ? patch.title.trim()
      : existing.title;

  const updated: ChatSession = {
    ...existing,
    title: nextTitle,
    updated_at: new Date().toISOString(),
  };
  await writeChatRecord(updated);
  return updated;
}

export async function deleteChat(
  chatId: string,
): Promise<{ deleted: boolean }> {
  const root = await ensureChatsDir();
  const existing = await readChatRecord(chatId);
  if (!existing) return { deleted: false };

  await rm(chatFile(root, chatId), { force: true });
  return { deleted: true };
}

export async function appendMessage(params: {
  chatId: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations?: CitationData[];
  tokens_used?: number | null;
}): Promise<{ chat: ChatSession; message: ChatMessage } | null> {
  const existing = await readChatRecord(params.chatId);
  if (!existing) return null;

  const now = new Date().toISOString();
  const content =
    typeof params.content === "string" ? params.content : String(params.content);

  const message: ChatMessage = {
    id: randomUUID(),
    conversation_id: existing.id,
    role: params.role,
    content,
    created_at: now,
  };
  if (params.citations) message.citations = params.citations;
  if (params.tokens_used !== undefined) message.tokens_used = params.tokens_used;

  let title = existing.title;
  if (
    params.role === "user" &&
    (title === DEFAULT_TITLE || !title) &&
    existing.messages.length === 0
  ) {
    title = titleFromContent(content);
  }

  const chat: ChatSession = {
    ...existing,
    title,
    updated_at: now,
    messages: [...existing.messages, message],
  };
  await writeChatRecord(chat);
  return { chat, message };
}

/** Persist a user+assistant turn after /api/chat streaming completes. */
export async function appendChatTurn(params: {
  conversationId?: string;
  userContent: string;
  assistantContent: string;
  citations: CitationData[];
}): Promise<{
  conversation_id: string;
  user: ChatMessage;
  assistant: ChatMessage;
}> {
  const now = new Date().toISOString();
  let chat: ChatSession | null = null;

  if (params.conversationId?.trim()) {
    chat = await readChatRecord(params.conversationId.trim());
  }
  if (!chat) {
    chat = await createChat({
      title: titleFromContent(params.userContent),
    });
  }

  const user: ChatMessage = {
    id: randomUUID(),
    conversation_id: chat.id,
    role: "user",
    content: params.userContent,
    created_at: now,
  };

  const assistant: ChatMessage = {
    id: randomUUID(),
    conversation_id: chat.id,
    role: "assistant",
    content: params.assistantContent,
    citations: params.citations,
    created_at: now,
  };

  const title =
    chat.title === DEFAULT_TITLE || !chat.title
      ? titleFromContent(params.userContent)
      : chat.title;

  const record: ChatSession = {
    ...chat,
    title,
    updated_at: now,
    messages: [...chat.messages, user, assistant],
  };
  await writeChatRecord(record);

  return { conversation_id: chat.id, user, assistant };
}
