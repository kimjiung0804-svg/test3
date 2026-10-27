import { NextResponse } from "next/server";
import { ensureStorageDirs } from "@/lib/storage";
import { embedText } from "@/lib/embedding/embedding-client";
import {
  getVectorStats,
  listAllChunks,
  similaritySearchDetailed,
} from "@/lib/vector-db/vector-db";
import { resolveMinScore } from "@/lib/vector-db/hybrid-score";
import { DEFAULT_RAG_SETTINGS } from "@/lib/rag-settings";

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

interface InspectBody {
  query?: string;
  file_id?: string;
  top_k?: number;
  /** Relevance threshold / minScore (0–1). Default from RAG settings (0.5). */
  min_score?: number;
  similarity_threshold?: number;
  /** When true, include hits below threshold (separately). Default true for inspect. */
  include_below_threshold?: boolean;
  list_all?: boolean;
  page?: number;
  limit?: number;
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
    const page = Math.max(1, Number(body.page) || 1);
    const limit = Math.max(1, Math.min(500, Number(body.limit) || 50));
    const topK = Math.max(1, Math.min(100, Number(body.top_k) || 10));
    const minScore = resolveMinScore(
      body.min_score ?? body.similarity_threshold,
      DEFAULT_RAG_SETTINGS.similarity_threshold,
    );
    const includeBelow =
      body.include_below_threshold === undefined
        ? true
        : Boolean(body.include_below_threshold);

    const stats = await getVectorStats();

    if (listAll) {
      const { chunks, total } = await listAllChunks({
        fileId,
        page,
        limit,
      });

      return NextResponse.json({
        chunks,
        total,
        query_embedding_generated: false,
        search_mode: "list_all",
        stats,
        page,
        limit,
      });
    }

    const query = String(body.query).trim();
    const embedded = await embedText(query);
    const result = await similaritySearchDetailed({
      queryEmbedding: embedded.embedding,
      queryText: query,
      fileId,
      topK,
      minScore,
      includeBelowThreshold: includeBelow,
    });

    return NextResponse.json({
      chunks: result.chunks,
      below_threshold: result.below_threshold,
      total: result.chunks.length,
      below_threshold_total: result.below_threshold.length,
      query_embedding_generated: true,
      search_mode: "similarity_hybrid",
      stats,
      embedding_model: embedded.model,
      embedding_source: embedded.source,
      top_k: result.top_k,
      min_score: result.min_score,
      similarity_threshold: result.min_score,
      hybrid_boost_applied: result.hybrid_boost_applied,
      keyword_gate_applied: result.keyword_gate_applied,
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
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
    const limit = Math.max(
      1,
      Math.min(500, Number(url.searchParams.get("limit") ?? "50") || 50),
    );

    const stats = await getVectorStats();
    const { chunks, total } = await listAllChunks({ fileId, page, limit });

    return NextResponse.json({
      chunks,
      total,
      query_embedding_generated: false,
      search_mode: "list_all",
      stats,
      page,
      limit,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Inspect failed";
    return errorResponse(500, "inspect_failed", message);
  }
}
