import { NextResponse } from "next/server";
import { ensureStorageDirs } from "@/lib/storage";
import { embedText } from "@/lib/embedding/embedding-client";
import { similaritySearch } from "@/lib/vector-db/vector-db";
import {
  LlmConfigError,
  LlmRequestError,
  streamChatCompletion,
} from "@/lib/llm/llm-client";
import {
  buildRagMessages,
  chunksToCitations,
} from "@/lib/rag/rag-prompt";
import { appendChatTurn } from "@/lib/chat/conversation-store";
import type { ChatStreamEvent } from "@/lib/types";

interface ChatBody {
  message?: string;
  conversation_id?: string;
  /** Alias used by chat-history UI (same as conversation_id). */
  session_id?: string;
  top_k?: number;
  file_filter?: string[];
  /** Per-request OpenAI-compatible base URL (UI selector). Env is default only. */
  baseUrl?: string;
  /** Alias for baseUrl. */
  base_url?: string;
  /** Alias for baseUrl (Multi-server selector). */
  server_url?: string;
  /** Per-request model id (UI selector). */
  model?: string;
  /** Alias for model. */
  selected_model?: string;
}

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

function sseEncode(event: ChatStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(request: Request) {
  try {
    await ensureStorageDirs();

    let body: ChatBody;
    try {
      body = (await request.json()) as ChatBody;
    } catch {
      return errorResponse(400, "invalid_json", "Request body must be JSON");
    }

    const message =
      typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      return errorResponse(400, "invalid_request", "Field 'message' is required");
    }

    const topK = Math.max(1, Math.min(50, Number(body.top_k) || 5));
    const fileFilter = Array.isArray(body.file_filter)
      ? body.file_filter.map(String).filter((id) => id.trim().length > 0)
      : undefined;
    const conversationId =
      (typeof body.conversation_id === "string" &&
        body.conversation_id.trim()) ||
      (typeof body.session_id === "string" && body.session_id.trim()) ||
      undefined;

    const baseUrlOverride =
      (typeof body.baseUrl === "string" && body.baseUrl.trim()) ||
      (typeof body.base_url === "string" && body.base_url.trim()) ||
      (typeof body.server_url === "string" && body.server_url.trim()) ||
      undefined;
    const modelOverride =
      (typeof body.model === "string" && body.model.trim()) ||
      (typeof body.selected_model === "string" &&
        body.selected_model.trim()) ||
      undefined;

    // 1) Embed query  2) Top-K similarity search
    const embedded = await embedText(message);
    const chunks = await similaritySearch({
      queryEmbedding: embedded.embedding,
      fileIds: fileFilter,
      topK,
    });
    const citations = chunksToCitations(chunks);
    const messages = buildRagMessages({ userMessage: message, chunks });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: ChatStreamEvent) => {
          controller.enqueue(encoder.encode(sseEncode(event)));
        };

        let assistantText = "";
        try {
          // Emit citations first so the UI can render source badges while streaming
          send({ type: "citations", citations });

          for await (const token of streamChatCompletion({
            messages,
            baseUrl: baseUrlOverride,
            model: modelOverride,
            signal: request.signal,
          })) {
            assistantText += token;
            send({ type: "chunk", content: token });
          }

          const saved = await appendChatTurn({
            conversationId,
            userContent: message,
            assistantContent: assistantText,
            citations,
          });

          send({
            type: "done",
            done: true,
            conversation_id: saved.conversation_id,
            message_id: saved.assistant.id,
          });
        } catch (err) {
          if (err instanceof LlmConfigError) {
            send({
              type: "error",
              error: "llm_not_configured",
              message: err.message,
            });
          } else if (err instanceof LlmRequestError) {
            send({
              type: "error",
              error: "llm_request_failed",
              message: err.message,
            });
          } else {
            const msg =
              err instanceof Error ? err.message : "Chat stream failed";
            send({ type: "error", error: "chat_failed", message: msg });
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    if (err instanceof LlmConfigError) {
      return errorResponse(503, "llm_not_configured", err.message);
    }
    const message = err instanceof Error ? err.message : "Chat failed";
    return errorResponse(500, "chat_failed", message);
  }
}
