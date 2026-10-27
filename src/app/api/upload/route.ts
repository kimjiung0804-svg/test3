import { randomUUID } from "crypto";
import path from "path";
import { NextResponse } from "next/server";
import { extractText } from "@/lib/extract";
import {
  ensureStorageDirs,
  getMaxFileSizeBytes,
  saveUploadedFile,
  updateFileMetadata,
} from "@/lib/storage";
import {
  ACCEPTED_EXTENSIONS,
  extensionToFileType,
  type FileMetadata,
} from "@/lib/types";
import {
  chunkText,
  resolveChunkOptions,
} from "@/lib/chunking/text-chunker";
import { embedTexts } from "@/lib/embedding/embedding-client";
import { indexFileChunks } from "@/lib/vector-db/vector-db";

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

export async function POST(request: Request) {
  try {
    await ensureStorageDirs();

    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return errorResponse(400, "invalid_request", "Missing multipart field: file");
    }

    const filename = file.name || "upload";
    const ext = path.extname(filename).toLowerCase();
    if (
      !ACCEPTED_EXTENSIONS.includes(
        ext as (typeof ACCEPTED_EXTENSIONS)[number],
      )
    ) {
      return errorResponse(
        400,
        "unsupported_type",
        `Accepted formats: ${ACCEPTED_EXTENSIONS.join(", ")}`,
      );
    }

    const fileType = extensionToFileType(ext);
    if (!fileType) {
      return errorResponse(400, "unsupported_type", `Unknown extension: ${ext}`);
    }

    const maxBytes = getMaxFileSizeBytes();
    if (file.size > maxBytes) {
      return errorResponse(
        400,
        "file_too_large",
        `File exceeds max size of ${Math.round(maxBytes / (1024 * 1024))}MB`,
      );
    }

    const chunkSizeRaw = form.get("chunk_size");
    const chunkOverlapRaw = form.get("chunk_overlap");
    const chunkOpts = resolveChunkOptions(
      chunkSizeRaw != null && String(chunkSizeRaw).trim() !== ""
        ? Number(chunkSizeRaw)
        : undefined,
      chunkOverlapRaw != null && String(chunkOverlapRaw).trim() !== ""
        ? Number(chunkOverlapRaw)
        : undefined,
    );

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let extracted;
    try {
      extracted = await extractText(buffer, fileType);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Parse failed";
      return errorResponse(400, "parse_error", message);
    }

    const textLength = extracted.text.trim().length;
    if (textLength === 0) {
      console.warn(
        `[extract] empty text after parse: filename=${filename} type=${fileType} size=${buffer.byteLength}`,
      );
      return errorResponse(
        400,
        "empty_extract",
        `No extractable text found in ${filename}. Re-check the file contents or format.`,
      );
    }

    if (fileType === "xlsx" || fileType === "xls") {
      const meta = extracted.metadata ?? {};
      console.info(
        `[extract] xlsx ok: filename=${filename} chars=${textLength} sheets=${meta.sheet_count ?? "?"} rows=${meta.data_row_count ?? "?"} cells=${meta.non_empty_cell_count ?? "?"}`,
      );
    } else {
      console.info(
        `[extract] ok: filename=${filename} type=${fileType} chars=${textLength}`,
      );
    }

    const fileId = randomUUID();
    const uploadedAt = new Date().toISOString();
    const storageRelative = path.join(
      "storage",
      "uploads",
      fileId,
      `original${ext}`,
    );

    const slices = chunkText(extracted.text, chunkOpts);
    const embeddings = await embedTexts(slices.map((s) => s.content));
    const { chunks_created } = await indexFileChunks({
      fileId,
      filename,
      fileType,
      chunks: slices,
      embeddings: embeddings.map((e) => ({
        embedding: e.embedding,
        model: e.model,
      })),
    });

    const metadata: FileMetadata = {
      id: fileId,
      filename,
      file_type: fileType,
      size: buffer.byteLength,
      storage_path: storageRelative,
      uploaded_at: uploadedAt,
      chunks_count: chunks_created,
      indexed: chunks_created > 0,
      chunk_config: {
        chunk_size: chunkOpts.chunkSize,
        chunk_overlap: chunkOpts.chunkOverlap,
      },
      metadata: extracted.metadata,
    };

    await saveUploadedFile({
      fileId,
      filename,
      buffer,
      metadata,
      extractedText: extracted.text,
    });

    // Ensure index reflects final chunk counts (saveUploadedFile already wrote meta)
    await updateFileMetadata(fileId, {
      chunks_count: chunks_created,
      indexed: chunks_created > 0,
      chunk_config: {
        chunk_size: chunkOpts.chunkSize,
        chunk_overlap: chunkOpts.chunkOverlap,
      },
    });

    return NextResponse.json({
      file_id: fileId,
      filename,
      size: buffer.byteLength,
      chunks_created,
      indexed_at: uploadedAt,
      text_extracted: true,
      text_length: extracted.text.length,
      chunk_config: {
        chunk_size: chunkOpts.chunkSize,
        chunk_overlap: chunkOpts.chunkOverlap,
      },
      embedding_model: embeddings[0]?.model ?? null,
      embedding_source: embeddings[0]?.source ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return errorResponse(500, "upload_failed", message);
  }
}
