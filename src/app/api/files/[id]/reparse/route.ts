import { NextResponse } from "next/server";
import { extractText } from "@/lib/extract";
import {
  ensureStorageDirs,
  getFileMetadata,
  getOriginalFileBuffer,
  saveExtractedText,
  updateFileMetadata,
} from "@/lib/storage";
import {
  chunkText,
  resolveChunkOptions,
} from "@/lib/chunking/text-chunker";
import { embedTexts } from "@/lib/embedding/embedding-client";
import { indexFileChunks } from "@/lib/vector-db/vector-db";

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Re-extract text from the stored original file and re-index vectors.
 * Use after parser fixes so existing uploads (e.g. SEDEX XLSX) pick up new text.
 */
export async function POST(request: Request, context: RouteContext) {
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

    const buffer = await getOriginalFileBuffer(id, meta.filename);
    if (!buffer) {
      return errorResponse(
        404,
        "original_missing",
        `Original file bytes not found for: ${id}`,
      );
    }

    let body: { chunk_size?: number; chunk_overlap?: number } = {};
    try {
      const raw = await request.text();
      if (raw.trim()) body = JSON.parse(raw) as typeof body;
    } catch {
      /* optional JSON body */
    }

    const chunkOpts = resolveChunkOptions(
      body.chunk_size ?? meta.chunk_config?.chunk_size,
      body.chunk_overlap ?? meta.chunk_config?.chunk_overlap,
    );

    let extracted;
    try {
      extracted = await extractText(buffer, meta.file_type);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Parse failed";
      return errorResponse(400, "parse_error", message);
    }

    const textLength = extracted.text.trim().length;
    if (textLength === 0) {
      console.warn(
        `[reparse] empty text: file_id=${id} filename=${meta.filename} type=${meta.file_type}`,
      );
      return errorResponse(
        400,
        "empty_extract",
        `No extractable text found when reparsing ${meta.filename}`,
      );
    }

    console.info(
      `[reparse] ok: file_id=${id} filename=${meta.filename} type=${meta.file_type} chars=${textLength}`,
    );

    await saveExtractedText(id, extracted.text);

    const slices = chunkText(extracted.text, chunkOpts);
    const sheetRowChunks = slices.filter(
      (s) => s.sheet_name != null || s.row_number != null,
    );
    const embeddings = await embedTexts(slices.map((s) => s.content));
    const { chunks_created } = await indexFileChunks({
      fileId: id,
      filename: meta.filename,
      fileType: meta.file_type,
      chunks: slices,
      embeddings: embeddings.map((e) => ({
        embedding: e.embedding,
        model: e.model,
      })),
    });

    if (meta.file_type === "xlsx" || meta.file_type === "xls") {
      console.info(
        `[reparse] xlsx vectordb: file=${meta.filename} chunks=${chunks_created} with_sheet_or_row=${sheetRowChunks.length} strategy=${slices[0]?.chunk_strategy ?? "?"}`,
      );
    }

    const updated = await updateFileMetadata(id, {
      chunks_count: chunks_created,
      indexed: chunks_created > 0,
      chunk_config: {
        chunk_size: chunkOpts.chunkSize,
        chunk_overlap: chunkOpts.chunkOverlap,
      },
      metadata: {
        ...(meta.metadata ?? {}),
        ...(extracted.metadata ?? {}),
        reparsed_at: new Date().toISOString(),
        chunk_strategy: slices[0]?.chunk_strategy ?? null,
      },
    });

    return NextResponse.json({
      file_id: id,
      filename: meta.filename,
      file_type: meta.file_type,
      text_length: textLength,
      chunks_created,
      indexed: chunks_created > 0,
      chunk_config: {
        chunk_size: chunkOpts.chunkSize,
        chunk_overlap: chunkOpts.chunkOverlap,
      },
      metadata: updated?.metadata ?? extracted.metadata,
      chunks_with_sheet_or_row: sheetRowChunks.length,
      chunk_strategy: slices[0]?.chunk_strategy ?? null,
      reparsed: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reparse failed";
    return errorResponse(500, "reparse_failed", message);
  }
}
