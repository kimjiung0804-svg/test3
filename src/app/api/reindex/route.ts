import { NextResponse } from "next/server";
import { extractText } from "@/lib/extract";
import {
  ensureStorageDirs,
  getOriginalFileBuffer,
  listFiles,
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

interface ReindexBody {
  file_ids?: string[];
  chunk_size?: number;
  chunk_overlap?: number;
}

/**
 * Re-extract + re-chunk + re-embed all (or selected) uploaded files.
 * Use after parser / chunking / retrieval metadata changes (e.g. XLSX sheet/row).
 *
 * POST /api/reindex
 * body (optional): { file_ids?: string[], chunk_size?: number, chunk_overlap?: number }
 *
 * Per-file alternative: POST /api/files/[id]/reparse
 */
export async function POST(request: Request) {
  try {
    await ensureStorageDirs();

    let body: ReindexBody = {};
    try {
      const raw = await request.text();
      if (raw.trim()) body = JSON.parse(raw) as ReindexBody;
    } catch {
      /* optional body */
    }

    const all = await listFiles();
    const idFilter =
      Array.isArray(body.file_ids) && body.file_ids.length > 0
        ? new Set(body.file_ids.map(String))
        : null;
    const targets = idFilter
      ? all.filter((f) => idFilter.has(f.id))
      : all;

    const results: Array<{
      file_id: string;
      filename: string;
      ok: boolean;
      chunks_created?: number;
      text_length?: number;
      error?: string;
    }> = [];

    for (const meta of targets) {
      try {
        const buffer = await getOriginalFileBuffer(meta.id, meta.filename);
        if (!buffer) {
          results.push({
            file_id: meta.id,
            filename: meta.filename,
            ok: false,
            error: "original_missing",
          });
          continue;
        }

        const chunkOpts = resolveChunkOptions(
          body.chunk_size ?? meta.chunk_config?.chunk_size,
          body.chunk_overlap ?? meta.chunk_config?.chunk_overlap,
        );

        const extracted = await extractText(buffer, meta.file_type);
        const textLength = extracted.text.trim().length;
        if (textLength === 0) {
          results.push({
            file_id: meta.id,
            filename: meta.filename,
            ok: false,
            error: "empty_extract",
            text_length: 0,
          });
          continue;
        }

        await saveExtractedText(meta.id, extracted.text);
        const slices = chunkText(extracted.text, chunkOpts);
        const embeddings = await embedTexts(slices.map((s) => s.content));
        const { chunks_created } = await indexFileChunks({
          fileId: meta.id,
          filename: meta.filename,
          fileType: meta.file_type,
          chunks: slices,
          embeddings: embeddings.map((e) => ({
            embedding: e.embedding,
            model: e.model,
          })),
        });

        await updateFileMetadata(meta.id, {
          chunks_count: chunks_created,
          indexed: chunks_created > 0,
          chunk_config: {
            chunk_size: chunkOpts.chunkSize,
            chunk_overlap: chunkOpts.chunkOverlap,
          },
          metadata: {
            ...(meta.metadata ?? {}),
            ...(extracted.metadata ?? {}),
            reindexed_at: new Date().toISOString(),
          },
        });

        results.push({
          file_id: meta.id,
          filename: meta.filename,
          ok: true,
          chunks_created,
          text_length: textLength,
        });
      } catch (err) {
        results.push({
          file_id: meta.id,
          filename: meta.filename,
          ok: false,
          error: err instanceof Error ? err.message : "reindex_failed",
        });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    return NextResponse.json({
      reindexed: okCount,
      failed: results.length - okCount,
      total: results.length,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reindex failed";
    return errorResponse(500, "reindex_failed", message);
  }
}

/** Document the reindex procedure. */
export async function GET() {
  return NextResponse.json({
    endpoint: "POST /api/reindex",
    description:
      "Re-extract, re-chunk, and re-embed all uploaded files (or a subset via file_ids).",
    per_file: "POST /api/files/[id]/reparse",
    body: {
      file_ids: "optional string[] — limit to specific uploads",
      chunk_size: "optional number",
      chunk_overlap: "optional number",
    },
    note: "Required after XLSX parser / sheet-row metadata changes so ./storage/vectordb reflects new chunks.",
  });
}
