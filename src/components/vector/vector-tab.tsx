"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { useRagSettings } from "@/hooks/use-rag-settings";
import { shortId } from "@/lib/rag-settings";
import type { FileMetadata, VectorInspectChunk } from "@/lib/types";

type InspectResponse = {
  chunks: VectorInspectChunk[];
  below_threshold?: VectorInspectChunk[];
  total: number;
  below_threshold_total?: number;
  search_mode: string;
  min_score?: number;
  hybrid_boost_applied?: boolean;
  stats?: {
    total_chunks?: number;
    total_files?: number;
  };
  page?: number;
  limit?: number;
};

export function VectorTab() {
  const { settings } = useRagSettings();
  const [query, setQuery] = useState("");
  const [listAll, setListAll] = useState(true);
  const [topK, setTopK] = useState(settings.top_k);
  const [fileId, setFileId] = useState("");
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [chunks, setChunks] = useState<VectorInspectChunk[]>([]);
  const [belowThreshold, setBelowThreshold] = useState<VectorInspectChunk[]>(
    [],
  );
  const [total, setTotal] = useState(0);
  const [mode, setMode] = useState("list_all");
  const [minScoreApplied, setMinScoreApplied] = useState<number | null>(null);
  const [stats, setStats] = useState<InspectResponse["stats"]>();
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<VectorInspectChunk | null>(null);
  const [filter, setFilter] = useState("");
  const limit = 50;

  useEffect(() => {
    setTopK(settings.top_k);
  }, [settings.top_k]);

  useEffect(() => {
    void fetch("/api/files?limit=100")
      .then((r) => r.json())
      .then((data: { files?: FileMetadata[] }) => setFiles(data.files ?? []))
      .catch(() => setFiles([]));
  }, []);

  const runInspect = useCallback(
    async (pageNum = 1) => {
      setLoading(true);
      setError(null);
      try {
        const body: Record<string, unknown> = {
          list_all: listAll || !query.trim(),
          page: pageNum,
          limit,
          top_k: topK,
          min_score: settings.similarity_threshold,
          similarity_threshold: settings.similarity_threshold,
          include_below_threshold: true,
        };
        if (query.trim() && !listAll) body.query = query.trim();
        if (fileId) body.file_id = fileId;

        const res = await fetch("/api/vector-inspect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || `Inspect failed (${res.status})`);
        }
        const data = (await res.json()) as InspectResponse;
        setChunks(data.chunks ?? []);
        setBelowThreshold(data.below_threshold ?? []);
        setTotal(data.total ?? 0);
        setMode(data.search_mode);
        setMinScoreApplied(
          typeof data.min_score === "number" ? data.min_score : null,
        );
        setStats(data.stats);
        setPage(data.page ?? pageNum);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Inspect failed");
      } finally {
        setLoading(false);
      }
    },
    [fileId, listAll, query, settings.similarity_threshold, topK],
  );

  useEffect(() => {
    void runInspect(1);
    // initial load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = filter.trim()
    ? chunks.filter((c) => {
        const q = filter.trim().toLowerCase();
        return (
          c.chunk_id.toLowerCase().includes(q) ||
          c.metadata?.filename?.toLowerCase().includes(q) ||
          c.content?.toLowerCase().includes(q)
        );
      })
    : chunks;

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const showSimilarity = mode === "similarity" || mode === "similarity_hybrid";

  function locLabel(chunk: VectorInspectChunk): string {
    const sheet = chunk.sheet_name ?? chunk.metadata?.sheet;
    const row = chunk.row_number ?? chunk.metadata?.row;
    if (sheet != null || row != null) {
      return [sheet ? `s:${sheet}` : null, row != null ? `r:${row}` : null]
        .filter(Boolean)
        .join(" ");
    }
    const page = chunk.page_number ?? chunk.metadata?.page_number;
    return page != null ? String(page) : "—";
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      <div className="rounded-xl border bg-muted/20 p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter query to test semantic similarity search…"
            rows={2}
            disabled={listAll}
          />
          <div className="flex flex-col gap-2 md:w-56">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={listAll}
                onChange={(e) => setListAll(e.target.checked)}
                className="size-4 rounded border"
              />
              List all chunks
            </label>
            <Button
              onClick={() => void runInspect(1)}
              disabled={loading || (!listAll && !query.trim())}
            >
              {loading ? <Loader2 className="animate-spin" /> : <Search />}
              Search
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="file-filter">Filter by file</Label>
            <select
              id="file-filter"
              value={fileId}
              onChange={(e) => setFileId(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
            >
              <option value="">All files</option>
              {files.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.filename}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Top-K</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{topK}</span>
            </div>
            <Slider
              min={1}
              max={50}
              step={1}
              value={[topK]}
              onValueChange={(v) => setTopK(Array.isArray(v) ? v[0]! : topK)}
              disabled={listAll}
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">mode: {mode}</Badge>
          {minScoreApplied != null && (
            <Badge variant="outline">
              minScore {minScoreApplied.toFixed(2)}
            </Badge>
          )}
          {stats?.total_chunks != null && (
            <Badge variant="secondary">{stats.total_chunks} chunks in DB</Badge>
          )}
          {stats?.total_files != null && (
            <Badge variant="secondary">{stats.total_files} files</Badge>
          )}
          {belowThreshold.length > 0 && (
            <Badge variant="destructive">
              {belowThreshold.length} below threshold
            </Badge>
          )}
          {error && <span className="text-destructive">{error}</span>}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter loaded results…"
          className="max-w-xs"
        />
        <span className="text-xs text-muted-foreground">
          Showing {filtered.length} / {total}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur">
            <tr className="border-b text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Chunk ID</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Seq</th>
              <th className="px-3 py-2 font-medium">Sheet/Row</th>
              <th className="px-3 py-2 font-medium">Preview</th>
              {showSimilarity && (
                <th className="px-3 py-2 font-medium">Score</th>
              )}
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={showSimilarity ? 7 : 6}
                  className="px-3 py-10 text-center text-muted-foreground"
                >
                  <Loader2 className="mx-auto size-5 animate-spin" />
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={showSimilarity ? 7 : 6}
                  className="px-3 py-10 text-center text-muted-foreground"
                >
                  No chunks found. Upload and index documents first.
                </td>
              </tr>
            ) : (
              filtered.map((chunk) => (
                <tr key={chunk.chunk_id || chunk.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-3 py-2 font-mono text-xs">
                    {shortId(chunk.chunk_id || chunk.id)}
                  </td>
                  <td className="px-3 py-2">{chunk.metadata?.filename ?? "—"}</td>
                  <td className="px-3 py-2">
                    {chunk.sequence_number ?? chunk.metadata?.chunk_sequence ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {locLabel(chunk)}
                  </td>
                  <td className="max-w-xs truncate px-3 py-2 text-muted-foreground">
                    {(chunk.content || chunk.metadata?.content_preview || "").slice(0, 100)}
                  </td>
                  {showSimilarity && (
                    <td className="px-3 py-2">
                      {typeof chunk.similarity_score === "number" ? (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-primary"
                              style={{
                                width: `${Math.min(100, Math.max(0, chunk.similarity_score * 100))}%`,
                              }}
                            />
                          </div>
                          <span className="tabular-nums text-xs">
                            {(chunk.similarity_score * 100).toFixed(1)}%
                          </span>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setSelected(chunk)}
                      aria-label="View full text"
                    >
                      <Eye />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {mode === "list_all" && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Page {page} / {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1 || loading}
              onClick={() => void runInspect(page - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages || loading}
              onClick={() => void runInspect(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {showSimilarity && belowThreshold.length > 0 && (
        <div className="rounded-xl border border-dashed border-amber-300/60 bg-amber-50/40 p-3 dark:bg-amber-950/20">
          <p className="mb-2 text-xs font-medium text-amber-800 dark:text-amber-200">
            Below relevance threshold (excluded from RAG context)
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {belowThreshold.slice(0, 8).map((c) => (
              <li key={c.chunk_id || c.id} className="flex flex-wrap gap-2">
                <span className="font-medium text-foreground">
                  {c.metadata?.filename}
                </span>
                <span className="tabular-nums">
                  score{" "}
                  {typeof c.similarity_score === "number"
                    ? c.similarity_score.toFixed(3)
                    : "—"}
                </span>
                {c.matched_tokens && c.matched_tokens.length > 0 && (
                  <span>tokens: {c.matched_tokens.join(", ")}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selected?.metadata?.filename ?? "Chunk detail"}
            </DialogTitle>
            <DialogDescription>
              {selected
                ? `chunk ${shortId(selected.chunk_id || selected.id)} · seq ${selected.sequence_number ?? "—"} · ${locLabel(selected)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto rounded-lg bg-muted/50 p-3 text-sm leading-relaxed whitespace-pre-wrap">
            {selected?.content || selected?.metadata?.content_preview || "—"}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
