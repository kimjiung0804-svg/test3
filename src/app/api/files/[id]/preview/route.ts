import { NextResponse } from "next/server";
import {
  ensureStorageDirs,
  getExtractedText,
  getFileMetadata,
} from "@/lib/storage";

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    await ensureStorageDirs();
    const { id } = await context.params;

    if (!id) {
      return errorResponse(400, "invalid_request", "Missing file id");
    }

    const meta = await getFileMetadata(id);
    if (!meta) {
      return errorResponse(404, "not_found", `File not found: ${id}`);
    }

    const text = await getExtractedText(id);
    if (text == null) {
      return errorResponse(
        404,
        "preview_unavailable",
        `Extracted text not found for: ${id}`,
      );
    }

    return NextResponse.json({
      file_id: meta.id,
      filename: meta.filename,
      file_type: meta.file_type,
      size: meta.size,
      uploaded_at: meta.uploaded_at,
      text,
      text_length: text.length,
      metadata: meta.metadata ?? {},
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Preview failed";
    return errorResponse(500, "preview_failed", message);
  }
}
