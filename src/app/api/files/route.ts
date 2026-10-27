import { NextResponse } from "next/server";
import { deleteFile, ensureStorageDirs, listFiles } from "@/lib/storage";
import type { FileMetadata } from "@/lib/types";

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

type SortKey = "uploaded_at" | "filename" | "size";

function sortFiles(
  files: FileMetadata[],
  sortBy: SortKey,
  order: "asc" | "desc",
): FileMetadata[] {
  const dir = order === "asc" ? 1 : -1;
  return [...files].sort((a, b) => {
    let cmp = 0;
    if (sortBy === "filename") {
      cmp = a.filename.localeCompare(b.filename);
    } else if (sortBy === "size") {
      cmp = a.size - b.size;
    } else {
      cmp = a.uploaded_at.localeCompare(b.uploaded_at);
    }
    return cmp * dir;
  });
}

export async function GET(request: Request) {
  try {
    await ensureStorageDirs();
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
    const limit = Math.max(
      1,
      Math.min(100, Number(url.searchParams.get("limit") ?? "20") || 20),
    );
    const sortByParam = url.searchParams.get("sort_by") ?? "uploaded_at";
    const orderParam = url.searchParams.get("order") ?? "desc";

    const sortBy: SortKey = (
      ["uploaded_at", "filename", "size"] as const
    ).includes(sortByParam as SortKey)
      ? (sortByParam as SortKey)
      : "uploaded_at";
    const order: "asc" | "desc" = orderParam === "asc" ? "asc" : "desc";

    const all = sortFiles(await listFiles(), sortBy, order);
    const total = all.length;
    const start = (page - 1) * limit;
    const files = all.slice(start, start + limit);

    return NextResponse.json({ files, total, page, limit });
  } catch (err) {
    const message = err instanceof Error ? err.message : "List failed";
    return errorResponse(500, "list_failed", message);
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureStorageDirs();
    const url = new URL(request.url);
    const fileId = url.searchParams.get("file_id");
    if (!fileId) {
      return errorResponse(400, "invalid_request", "Missing query: file_id");
    }

    const result = await deleteFile(fileId);
    if (!result.deleted) {
      return errorResponse(404, "not_found", `File not found: ${fileId}`);
    }

    return NextResponse.json({
      deleted: true,
      file_id: fileId,
      chunks_removed: result.chunks_removed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delete failed";
    return errorResponse(500, "delete_failed", message);
  }
}
