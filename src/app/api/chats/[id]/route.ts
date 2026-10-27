import { NextResponse } from "next/server";
import { ensureStorageDirs } from "@/lib/storage";
import {
  deleteChat,
  getChat,
  updateChat,
} from "@/lib/chat/conversation-store";

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** GET /api/chats/[id] — session including messages */
export async function GET(_request: Request, context: RouteContext) {
  try {
    await ensureStorageDirs();
    const { id } = await context.params;
    if (!id) {
      return errorResponse(400, "invalid_request", "Missing chat id");
    }

    const chat = await getChat(id);
    if (!chat) {
      return errorResponse(404, "not_found", `Chat not found: ${id}`);
    }

    return NextResponse.json(chat);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Get chat failed";
    return errorResponse(500, "get_failed", message);
  }
}

/** PATCH /api/chats/[id] — update title etc. */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    await ensureStorageDirs();
    const { id } = await context.params;
    if (!id) {
      return errorResponse(400, "invalid_request", "Missing chat id");
    }

    let body: { title?: string };
    try {
      body = (await request.json()) as { title?: string };
    } catch {
      return errorResponse(400, "invalid_json", "Request body must be JSON");
    }

    if (body.title !== undefined && typeof body.title !== "string") {
      return errorResponse(400, "invalid_request", "Field 'title' must be a string");
    }
    if (typeof body.title === "string" && !body.title.trim()) {
      return errorResponse(400, "invalid_request", "Field 'title' must not be empty");
    }

    const chat = await updateChat(id, { title: body.title });
    if (!chat) {
      return errorResponse(404, "not_found", `Chat not found: ${id}`);
    }

    return NextResponse.json(chat);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update chat failed";
    return errorResponse(500, "update_failed", message);
  }
}

/** DELETE /api/chats/[id] */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    await ensureStorageDirs();
    const { id } = await context.params;
    if (!id) {
      return errorResponse(400, "invalid_request", "Missing chat id");
    }

    const result = await deleteChat(id);
    if (!result.deleted) {
      return errorResponse(404, "not_found", `Chat not found: ${id}`);
    }

    return NextResponse.json({ deleted: true, id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delete chat failed";
    return errorResponse(500, "delete_failed", message);
  }
}
