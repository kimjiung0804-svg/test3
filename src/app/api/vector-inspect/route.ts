import { NextResponse } from "next/server";
import { ensureStorageDirs } from "@/lib/storage";
import { embedText } from "@/lib/embedding/embedding-client";
import {
  getVectorStats,
  listAllChunks,
  similaritySearch,
} from "@/lib/vector-db/vector-db";

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

interface InspectBody {
  query?: string;
  file_id?: string;
  top_k?: number;
  list_all?: boolean;
  page?: number;
  limit?: number;
  /** Case-insensitive AND filter (e.g. "삼성전자 C100") over content + XLSX metadata. */
  contains?: string;
}

export async function POST(request: Request) {
  try {
    await ensureStorageDirs();

    let body: InspectBody = {};
    try {
      body = (await request.json()) as InspectBody;
    } catch {
      body = {};
    }

    const listAll = Boolean(body.list_all) || !body.query?.trim();
    const fileId =
      body.file_id && String(body.file_id).trim()
        ? String(body.file_id).trim()
        : undefined;
    const contains =
      body.contains && String(body.contains).trim()
        ? String(body.contains).trim()
        : undefined;
    const page = Math.max(1, Number(body.page) || 1);
    const limit = Math.max(1, Math.min(500, Number(body.limit) || 50));
    const topK = Math.max(1, Math.min(100, Number(body.top_k) || 10));

    const stats = await getVectorStats();

    if (listAll) {
      const { chunks, total } = await listAllChunks({
        fileId,
        page,
        limit,
        contains,
      });

      return NextResponse.json({
        chunks,
        total,
        query_embedding_generated: false,
        search_mode: contains ? "list_filtered" : "list_all",
        contains: contains ?? null,
        stats,
        page,
        limit,
      });
    }

    const query = String(body.query).trim();
    const embedded = await embedText(query);
    const chunks = await similaritySearch({
      queryEmbedding: embedded.embedding,
      fileId,
      topK,
    });

    return NextResponse.json({
      chunks,
      total: chunks.length,
      query_embedding_generated: true,
      search_mode: "similarity",
      stats,
      embedding_model: embedded.model,
      embedding_source: embedded.source,
      top_k: topK,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Inspect failed";
    return errorResponse(500, "inspect_failed", message);
  }
}

/** Convenience GET: list chunks / stats without a body. */
export async function GET(request: Request) {
  try {
    await ensureStorageDirs();
    const url = new URL(request.url);
    const fileId = url.searchParams.get("file_id") || undefined;
    const contains = url.searchParams.get("contains") || undefined;
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
    const limit = Math.max(
      1,
      Math.min(500, Number(url.searchParams.get("limit") ?? "50") || 50),
    );

    const stats = await getVectorStats();
    const { chunks, total } = await listAllChunks({
      fileId,
      page,
      limit,
      contains,
    });

    return NextResponse.json({
      chunks,
      total,
      query_embedding_generated: false,
      search_mode: contains ? "list_filtered" : "list_all",
      contains: contains ?? null,
      stats,
      page,
      limit,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Inspect failed";
    return errorResponse(500, "inspect_failed", message);
  }
}
