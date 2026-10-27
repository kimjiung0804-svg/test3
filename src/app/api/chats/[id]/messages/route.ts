import { NextResponse } from "next/server";
import { ensureStorageDirs } from "@/lib/storage";
import { appendMessage } from "@/lib/chat/conversation-store";
import type { CitationData } from "@/lib/types";

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

interface AppendBody {
  role?: string;
  content?: string;
  citations?: CitationData[];
  tokens_used?: number | null;
}

/** POST /api/chats/[id]/messages — append a user/assistant/system message */
export async function POST(request: Request, context: RouteContext) {
  try {
    await ensureStorageDirs();
    const { id } = await context.params;
    if (!id) {
      return errorResponse(400, "invalid_request", "Missing chat id");
    }

    let body: AppendBody;
    try {
      body = (await request.json()) as AppendBody;
    } catch {
      return errorResponse(400, "invalid_json", "Request body must be JSON");
    }

    const role = body.role;
    if (role !== "user" && role !== "assistant" && role !== "system") {
      return errorResponse(
        400,
        "invalid_request",
        "Field 'role' must be 'user', 'assistant', or 'system'",
      );
    }

    const content =
      typeof body.content === "string" ? body.content : "";
    if (!content.trim() && role !== "assistant") {
      return errorResponse(400, "invalid_request", "Field 'content' is required");
    }

    const result = await appendMessage({
      chatId: id,
      role,
      content,
      citations: Array.isArray(body.citations) ? body.citations : undefined,
      tokens_used: body.tokens_used,
    });

    if (!result) {
      return errorResponse(404, "not_found", `Chat not found: ${id}`);
    }

    return NextResponse.json(
      { message: result.message, chat: result.chat },
      { status: 201 },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Append message failed";
    return errorResponse(500, "append_failed", message);
  }
}
