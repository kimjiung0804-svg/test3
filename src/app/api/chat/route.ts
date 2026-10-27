import { NextResponse } from "next/server";
import { ensureStorageDirs } from "@/lib/storage";
import { embedText } from "@/lib/embedding/embedding-client";
import { similaritySearchDetailed } from "@/lib/vector-db/vector-db";
import { resolveMinScore } from "@/lib/vector-db/hybrid-score";
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
import { DEFAULT_RAG_SETTINGS } from "@/lib/rag-settings";

interface ChatBody {
  message?: string;
  conversation_id?: string;
  top_k?: number;
  /** Relevance threshold / minScore (0–1). */
  min_score?: number;
  similarity_threshold?: number;
  file_filter?: string[];
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
    const minScore = resolveMinScore(
      body.min_score ?? body.similarity_threshold,
      DEFAULT_RAG_SETTINGS.similarity_threshold,
    );
    const fileFilter = Array.isArray(body.file_filter)
      ? body.file_filter.map(String).filter((id) => id.trim().length > 0)
      : undefined;
    const conversationId =
      typeof body.conversation_id === "string" && body.conversation_id.trim()
        ? body.conversation_id.trim()
        : undefined;

    // 1) Embed query  2) Hybrid Top-K + relevance threshold
    const embedded = await embedText(message);
    const retrieval = await similaritySearchDetailed({
      queryEmbedding: embedded.embedding,
      queryText: message,
      fileIds: fileFilter,
      topK,
      minScore,
      includeBelowThreshold: false,
    });
    const chunks = retrieval.chunks;
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
