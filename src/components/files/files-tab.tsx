"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Eye,
  FileText,
  Loader2,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useRagSettings } from "@/hooks/use-rag-settings";
import { formatBytes, formatRelativeTime } from "@/lib/rag-settings";
import type { FileMetadata } from "@/lib/types";
import { cn } from "@/lib/utils";

type PreviewPayload = {
  file_id: string;
  filename: string;
  file_type: string;
  size: number;
  uploaded_at: string;
  text: string;
  text_length: number;
};

export function FilesTab() {
  const { settings } = useRagSettings();
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<FileMetadata | null>(null);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const limit = 20;

  const loadFiles = useCallback(async (pageNum = 1) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/files?page=${pageNum}&limit=${limit}&sort_by=uploaded_at&order=desc`,
      );
      if (!res.ok) throw new Error(`List failed (${res.status})`);
      const data = (await res.json()) as {
        files: FileMetadata[];
        total: number;
        page: number;
      };
      setFiles(data.files);
      setTotal(data.total);
      setPage(data.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFiles(1);
  }, [loadFiles]);

  async function uploadFiles(fileList: FileList | File[]) {
    const list = Array.from(fileList);
    if (!list.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of list) {
        const form = new FormData();
        form.append("file", file);
        form.append("chunk_size", String(settings.chunk_size));
        form.append("chunk_overlap", String(settings.chunk_overlap));
        const res = await fetch("/api/upload", { method: "POST", body: form });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || `Upload failed for ${file.name}`);
        }
      }
      await loadFiles(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function openPreview(file: FileMetadata) {
    setPreviewFile(file);
    setPreview(null);
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/files/${file.id}/preview`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Preview unavailable");
      }
      setPreview((await res.json()) as PreviewPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
      setPreviewFile(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function deleteFile(file: FileMetadata) {
    if (
      !confirm(
        `Are you sure? This will remove ${file.filename} and all associated chunks.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/files?file_id=${encodeURIComponent(file.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Delete failed");
      }
      if (previewFile?.id === file.id) {
        setPreviewFile(null);
        setPreview(null);
      }
      await loadFiles(page);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const filtered = query.trim()
    ? files.filter((f) =>
        f.filename.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : files;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition",
          dragOver
            ? "border-primary bg-primary/5"
            : "border-border bg-muted/30 hover:bg-muted/50",
        )}
      >
        <UploadCloud className="size-8 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">Drop documents here, or browse</p>
          <p className="text-xs text-muted-foreground">
            PDF, DOCX, DOC, XLSX, XLS · chunk {settings.chunk_size}/{settings.chunk_overlap}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <>
              <Loader2 className="animate-spin" /> Uploading…
            </>
          ) : (
            "Choose files"
          )}
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.doc,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by filename…"
          className="max-w-xs"
        />
        <span className="text-xs text-muted-foreground">{total} file(s)</span>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur">
            <tr className="border-b text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Filename</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Size</th>
              <th className="px-3 py-2 font-medium">Chunks</th>
              <th className="px-3 py-2 font-medium">Uploaded</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto size-5 animate-spin" />
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                  No files yet. Upload a document to get started.
                </td>
              </tr>
            ) : (
              filtered.map((file) => (
                <tr
                  key={file.id}
                  className="cursor-pointer border-b last:border-0 hover:bg-muted/40"
                  onClick={() => void openPreview(file)}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <span className="font-medium">{file.filename}</span>
                      {file.indexed && (
                        <Badge variant="secondary" className="text-[10px]">
                          indexed
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 uppercase text-muted-foreground">
                    {file.file_type}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatBytes(file.size)}
                  </td>
                  <td className="px-3 py-2">{file.chunks_count}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatRelativeTime(file.uploaded_at)}
                  </td>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => void openPreview(file)}
                        aria-label="Preview"
                      >
                        <Eye />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => void deleteFile(file)}
                        aria-label="Delete"
                      >
                        <Trash2 className="text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Page {page} / {totalPages}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1 || loading}
            onClick={() => void loadFiles(page - 1)}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages || loading}
            onClick={() => void loadFiles(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      <Sheet
        open={!!previewFile}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewFile(null);
            setPreview(null);
          }
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{previewFile?.filename}</SheetTitle>
            <SheetDescription>
              {previewFile
                ? `${previewFile.file_type.toUpperCase()} · ${formatBytes(previewFile.size)} · ${formatRelativeTime(previewFile.uploaded_at)}`
                : ""}
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-4">
            {previewFile && (
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-3 text-xs">
                <div>
                  <p className="text-muted-foreground">File ID</p>
                  <p className="font-mono">{previewFile.id.slice(0, 12)}…</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Chunks</p>
                  <p>{previewFile.chunks_count}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Indexed</p>
                  <p>{previewFile.indexed ? "Yes" : "No"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Chunk config</p>
                  <p>
                    {previewFile.chunk_config
                      ? `${previewFile.chunk_config.chunk_size} / ${previewFile.chunk_config.chunk_overlap}`
                      : "—"}
                  </p>
                </div>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-background p-3 text-sm leading-relaxed whitespace-pre-wrap">
              {previewLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading extracted text…
                </div>
              ) : (
                preview?.text || "No extracted text."
              )}
            </div>
            {previewFile && (
              <Button
                variant="destructive"
                onClick={() => void deleteFile(previewFile)}
              >
                <Trash2 /> Delete file
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
