import { NextResponse } from "next/server";
import { ensureStorageDirs } from "@/lib/storage";
import { createChat, listChats } from "@/lib/chat/conversation-store";

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

/** GET /api/chats — session list (id, title, updated_at, …) */
export async function GET() {
  try {
    await ensureStorageDirs();
    const chats = await listChats();
    return NextResponse.json({ chats, total: chats.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "List chats failed";
    return errorResponse(500, "list_failed", message);
  }
}

/** POST /api/chats — create a new empty session */
export async function POST(request: Request) {
  try {
    await ensureStorageDirs();

    let title: string | undefined;
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        const body = (await request.json()) as { title?: string };
        if (typeof body.title === "string") title = body.title;
      } catch {
        return errorResponse(400, "invalid_json", "Request body must be JSON");
      }
    }

    const chat = await createChat({ title });
    return NextResponse.json(chat, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Create chat failed";
    return errorResponse(500, "create_failed", message);
  }
}
