import { NextResponse } from "next/server";
import { parseSpreadsheetPreviewRows } from "@/lib/extract";
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

export async function GET(request: Request, context: RouteContext) {
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

    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();

    const extractFormat =
      typeof meta.metadata?.extract_format === "string"
        ? meta.metadata.extract_format
        : null;

    const metaRows = Array.isArray(meta.metadata?.rows)
      ? (meta.metadata.rows as Array<{
          sheet?: string;
          row_index?: number;
          fields?: Record<string, string>;
          text?: string;
        }>)
      : null;

    let rows =
      metaRows && metaRows.length > 0
        ? metaRows.map((r) => ({
            sheet: r.sheet ?? "",
            row_index: r.row_index ?? 0,
            fields: r.fields ?? {},
            text: r.text ?? "",
          }))
        : extractFormat === "header_row_pairs" ||
            meta.file_type === "xlsx" ||
            meta.file_type === "xls"
          ? parseSpreadsheetPreviewRows(text).map((r) => ({
              sheet: r.sheet,
              row_index: r.row_index,
              fields: r.fields,
              text: r.text,
            }))
          : [];

    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter((r) => {
        if (r.text.toLowerCase().includes(needle)) return true;
        return Object.values(r.fields).some((v) =>
          String(v).toLowerCase().includes(needle),
        );
      });
    }

    return NextResponse.json({
      file_id: meta.id,
      filename: meta.filename,
      file_type: meta.file_type,
      size: meta.size,
      uploaded_at: meta.uploaded_at,
      text,
      text_length: text.length,
      extract_format: extractFormat,
      row_count: rows.length,
      rows,
      metadata: meta.metadata ?? {},
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Preview failed";
    return errorResponse(500, "preview_failed", message);
  }
}
