import { randomUUID } from "crypto";
import path from "path";
import { NextResponse } from "next/server";
import { extractText } from "@/lib/extract";
import {
  ensureStorageDirs,
  getMaxFileSizeBytes,
  saveUploadedFile,
} from "@/lib/storage";
import {
  ACCEPTED_EXTENSIONS,
  extensionToFileType,
  type FileMetadata,
} from "@/lib/types";

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
    const chunk_size =
      chunkSizeRaw != null && String(chunkSizeRaw).trim() !== ""
        ? Number(chunkSizeRaw)
        : 500;
    const chunk_overlap =
      chunkOverlapRaw != null && String(chunkOverlapRaw).trim() !== ""
        ? Number(chunkOverlapRaw)
        : 50;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let extracted;
    try {
      extracted = await extractText(buffer, fileType);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Parse failed";
      return errorResponse(400, "parse_error", message);
    }

    const fileId = randomUUID();
    const uploadedAt = new Date().toISOString();
    const storageRelative = path.join(
      "storage",
      "uploads",
      fileId,
      `original${ext}`,
    );

    const metadata: FileMetadata = {
      id: fileId,
      filename,
      file_type: fileType,
      size: buffer.byteLength,
      storage_path: storageRelative,
      uploaded_at: uploadedAt,
      chunks_count: 0,
      indexed: false,
      chunk_config: {
        chunk_size: Number.isFinite(chunk_size) ? chunk_size : 500,
        chunk_overlap: Number.isFinite(chunk_overlap) ? chunk_overlap : 50,
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

    return NextResponse.json({
      file_id: fileId,
      filename,
      size: buffer.byteLength,
      chunks_created: 0,
      indexed_at: uploadedAt,
      text_extracted: true,
      text_length: extracted.text.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return errorResponse(500, "upload_failed", message);
  }
}
