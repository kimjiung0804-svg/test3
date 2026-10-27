import { mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { ensureStorageDirs } from "@/lib/storage";
import type { TextChunk, VectorRecord, VectorInspectChunk } from "@/lib/types";
import { cosineSimilarity } from "@/lib/embedding/embedding-client";

const FILE_STORE_DIR = "files";
const CATALOG_FILENAME = "catalog.json";

interface FileVectorStore {
  file_id: string;
  filename: string;
  file_type: string;
  chunks: TextChunk[];
  vectors: VectorRecord[];
  updated_at: string;
}

interface CatalogEntry {
  file_id: string;
  filename: string;
  chunks_count: number;
  indexed_at: string;
}

interface Catalog {
  version: number;
  files: CatalogEntry[];
}

async function ensureVectorDirs(): Promise<string> {
  const { vectorDbPath } = await ensureStorageDirs();
  await mkdir(path.join(vectorDbPath, FILE_STORE_DIR), { recursive: true });
  return vectorDbPath;
}

function fileStorePath(vectorDbPath: string, fileId: string) {
  return path.join(vectorDbPath, FILE_STORE_DIR, `${fileId}.json`);
}

function catalogPath(vectorDbPath: string) {
  return path.join(vectorDbPath, CATALOG_FILENAME);
}

async function readCatalog(vectorDbPath: string): Promise<Catalog> {
  try {
    const raw = await readFile(catalogPath(vectorDbPath), "utf-8");
    const parsed = JSON.parse(raw) as Catalog;
    return {
      version: parsed.version ?? 1,
      files: Array.isArray(parsed.files) ? parsed.files : [],
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { version: 1, files: [] };
    throw err;
  }
}

async function writeCatalog(
  vectorDbPath: string,
  catalog: Catalog,
): Promise<void> {
  await writeFile(
    catalogPath(vectorDbPath),
    JSON.stringify(catalog, null, 2),
    "utf-8",
  );
}

async function readFileStore(
  vectorDbPath: string,
  fileId: string,
): Promise<FileVectorStore | null> {
  try {
    const raw = await readFile(fileStorePath(vectorDbPath, fileId), "utf-8");
    return JSON.parse(raw) as FileVectorStore;
  } catch {
    return null;
  }
}

async function writeFileStore(
  vectorDbPath: string,
  store: FileVectorStore,
): Promise<void> {
  await writeFile(
    fileStorePath(vectorDbPath, store.file_id),
    JSON.stringify(store, null, 2),
    "utf-8",
  );
}

export async function indexFileChunks(params: {
  fileId: string;
  filename: string;
  fileType: string;
  chunks: Array<{
    content: string;
    sequence_number: number;
    start_char: number;
    end_char: number;
    page_number: number | null;
  }>;
  embeddings: Array<{ embedding: number[]; model: string }>;
}): Promise<{ chunks_created: number; vectors: VectorRecord[] }> {
  const vectorDbPath = await ensureVectorDirs();
  const now = new Date().toISOString();

  // Replace any prior index for this file
  await deleteFileVectors(params.fileId);

  const textChunks: TextChunk[] = [];
  const vectors: VectorRecord[] = [];

  for (let i = 0; i < params.chunks.length; i++) {
    const slice = params.chunks[i]!;
    const emb = params.embeddings[i]!;
    const chunkId = randomUUID();
    const vectorId = randomUUID();

    textChunks.push({
      id: chunkId,
      file_id: params.fileId,
      content: slice.content,
      sequence_number: slice.sequence_number,
      start_char: slice.start_char,
      end_char: slice.end_char,
      page_number: slice.page_number,
      created_at: now,
    });

    vectors.push({
      id: vectorId,
      chunk_id: chunkId,
      file_id: params.fileId,
      embedding: emb.embedding,
      embedding_model: emb.model,
      metadata: {
        filename: params.filename,
        chunk_sequence: slice.sequence_number,
        page_number: slice.page_number,
        file_type: params.fileType,
        content_preview: slice.content.slice(0, 100),
      },
      indexed_at: now,
    });
  }

  const store: FileVectorStore = {
    file_id: params.fileId,
    filename: params.filename,
    file_type: params.fileType,
    chunks: textChunks,
    vectors,
    updated_at: now,
  };
  await writeFileStore(vectorDbPath, store);

  const catalog = await readCatalog(vectorDbPath);
  catalog.files = catalog.files.filter((f) => f.file_id !== params.fileId);
  catalog.files.push({
    file_id: params.fileId,
    filename: params.filename,
    chunks_count: textChunks.length,
    indexed_at: now,
  });
  await writeCatalog(vectorDbPath, catalog);

  return { chunks_created: textChunks.length, vectors };
}

export async function deleteFileVectors(
  fileId: string,
): Promise<{ chunks_removed: number }> {
  const vectorDbPath = await ensureVectorDirs();
  const existing = await readFileStore(vectorDbPath, fileId);
  const chunksRemoved = existing?.chunks.length ?? 0;

  await rm(fileStorePath(vectorDbPath, fileId), { force: true });

  const catalog = await readCatalog(vectorDbPath);
  catalog.files = catalog.files.filter((f) => f.file_id !== fileId);
  await writeCatalog(vectorDbPath, catalog);

  return { chunks_removed: chunksRemoved };
}

function toInspectChunk(
  store: FileVectorStore,
  vector: VectorRecord,
  chunk: TextChunk | undefined,
  similarity?: number,
): VectorInspectChunk {
  return {
    ...vector,
    content: chunk?.content ?? vector.metadata.content_preview,
    sequence_number:
      chunk?.sequence_number ?? vector.metadata.chunk_sequence,
    start_char: chunk?.start_char,
    end_char: chunk?.end_char,
    page_number: chunk?.page_number ?? vector.metadata.page_number,
    similarity_score: similarity,
  };
}

export async function listAllChunks(params?: {
  fileId?: string;
  page?: number;
  limit?: number;
}): Promise<{
  chunks: VectorInspectChunk[];
  total: number;
}> {
  const vectorDbPath = await ensureVectorDirs();
  const catalog = await readCatalog(vectorDbPath);
  const fileIds = params?.fileId
    ? catalog.files.filter((f) => f.file_id === params.fileId).map((f) => f.file_id)
    : catalog.files.map((f) => f.file_id);

  const all: VectorInspectChunk[] = [];
  for (const fileId of fileIds) {
    const store = await readFileStore(vectorDbPath, fileId);
    if (!store) continue;
    const byChunk = new Map(store.chunks.map((c) => [c.id, c]));
    for (const vector of store.vectors) {
      all.push(toInspectChunk(store, vector, byChunk.get(vector.chunk_id)));
    }
  }

  all.sort((a, b) => {
    const fa = a.metadata.filename.localeCompare(b.metadata.filename);
    if (fa !== 0) return fa;
    return (a.sequence_number ?? 0) - (b.sequence_number ?? 0);
  });

  const total = all.length;
  const page = Math.max(1, params?.page ?? 1);
  const limit = Math.max(1, Math.min(500, params?.limit ?? 50));
  const start = (page - 1) * limit;
  return { chunks: all.slice(start, start + limit), total };
}

export async function similaritySearch(params: {
  queryEmbedding: number[];
  fileId?: string;
  /** Limit search to one or more file IDs (chat `file_filter`). */
  fileIds?: string[];
  topK?: number;
}): Promise<VectorInspectChunk[]> {
  const vectorDbPath = await ensureVectorDirs();
  const catalog = await readCatalog(vectorDbPath);
  const filterSet =
    params.fileIds && params.fileIds.length > 0
      ? new Set(params.fileIds)
      : params.fileId
        ? new Set([params.fileId])
        : null;
  const fileIds = filterSet
    ? catalog.files.filter((f) => filterSet.has(f.file_id)).map((f) => f.file_id)
    : catalog.files.map((f) => f.file_id);

  const scored: VectorInspectChunk[] = [];
  for (const fileId of fileIds) {
    const store = await readFileStore(vectorDbPath, fileId);
    if (!store) continue;
    const byChunk = new Map(store.chunks.map((c) => [c.id, c]));
    for (const vector of store.vectors) {
      const score = cosineSimilarity(params.queryEmbedding, vector.embedding);
      scored.push(
        toInspectChunk(store, vector, byChunk.get(vector.chunk_id), score),
      );
    }
  }

  scored.sort((a, b) => (b.similarity_score ?? 0) - (a.similarity_score ?? 0));
  const topK = Math.max(1, Math.min(100, params.topK ?? 10));
  return scored.slice(0, topK);
}

export async function getVectorStats(): Promise<{
  total_files: number;
  total_chunks: number;
  indexed_files: number;
  storage_path: string;
  embedding_dims: number | null;
}> {
  const vectorDbPath = await ensureVectorDirs();
  const catalog = await readCatalog(vectorDbPath);
  const total_chunks = catalog.files.reduce((s, f) => s + f.chunks_count, 0);

  let embedding_dims: number | null = null;
  if (catalog.files[0]) {
    const store = await readFileStore(vectorDbPath, catalog.files[0].file_id);
    embedding_dims = store?.vectors[0]?.embedding.length ?? null;
  }

  // Prefer env-relative path for API transparency (no absolute path leak)
  const relative =
    process.env.VECTORDB_PATH ??
    process.env.VECTOR_DB_PATH ??
    "./storage/vectordb";

  return {
    total_files: catalog.files.length,
    total_chunks,
    indexed_files: catalog.files.length,
    storage_path: relative,
    embedding_dims,
  };
}

/** Rebuild catalog by scanning files/ if needed (recovery helper). */
export async function rebuildCatalogFromDisk(): Promise<Catalog> {
  const vectorDbPath = await ensureVectorDirs();
  const dir = path.join(vectorDbPath, FILE_STORE_DIR);
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    names = [];
  }

  const files: CatalogEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const store = await readFileStore(
      vectorDbPath,
      name.replace(/\.json$/, ""),
    );
    if (!store) continue;
    files.push({
      file_id: store.file_id,
      filename: store.filename,
      chunks_count: store.chunks.length,
      indexed_at: store.updated_at,
    });
  }

  const catalog: Catalog = { version: 1, files };
  await writeCatalog(vectorDbPath, catalog);
  return catalog;
}
