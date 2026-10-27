import { mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import path from "path";
import type { FileMetadata } from "./types";

const INDEX_FILENAME = "index.json";
const METADATA_FILENAME = "metadata.json";
const TEXT_FILENAME = "extracted.txt";
const ORIGINAL_BASENAME = "original";

/**
 * Resolve storage paths from env (with defaults) and ensure dirs exist at runtime.
 * Prefer Task 2 `.env.example` names; fall back to spec.json names.
 */
export function getStoragePaths() {
  const storagePath =
    process.env.STORAGE_PATH ??
    process.env.UPLOAD_STORAGE_PATH ??
    path.join(".", "storage", "uploads");
  const vectorDbPath =
    process.env.VECTORDB_PATH ??
    process.env.VECTOR_DB_PATH ??
    path.join(".", "storage", "vectordb");

  return {
    storagePath: path.resolve(storagePath),
    vectorDbPath: path.resolve(vectorDbPath),
  };
}

/** Create upload and vector DB directories if missing (idempotent). */
export async function ensureStorageDirs(): Promise<{
  storagePath: string;
  vectorDbPath: string;
}> {
  const { storagePath, vectorDbPath } = getStoragePaths();
  await mkdir(storagePath, { recursive: true });
  await mkdir(vectorDbPath, { recursive: true });
  return { storagePath, vectorDbPath };
}

function indexPath(storagePath: string) {
  return path.join(storagePath, INDEX_FILENAME);
}

function fileDir(storagePath: string, fileId: string) {
  return path.join(storagePath, fileId);
}

async function readIndex(storagePath: string): Promise<FileMetadata[]> {
  try {
    const raw = await readFile(indexPath(storagePath), "utf-8");
    const parsed = JSON.parse(raw) as FileMetadata[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }
}

async function writeIndex(
  storagePath: string,
  files: FileMetadata[],
): Promise<void> {
  await writeFile(
    indexPath(storagePath),
    JSON.stringify(files, null, 2),
    "utf-8",
  );
}

/** Persist original bytes under uploads/{id}/original.{ext}. */
export async function saveUploadedFile(params: {
  fileId: string;
  filename: string;
  buffer: Buffer;
  metadata: FileMetadata;
  extractedText: string;
}): Promise<FileMetadata> {
  const { storagePath } = await ensureStorageDirs();
  const dir = fileDir(storagePath, params.fileId);
  await mkdir(dir, { recursive: true });

  const ext = path.extname(params.filename).toLowerCase() || "";
  const originalName = `${ORIGINAL_BASENAME}${ext}`;
  const absoluteOriginal = path.join(dir, originalName);
  await writeFile(absoluteOriginal, params.buffer);
  await writeFile(
    path.join(dir, METADATA_FILENAME),
    JSON.stringify(params.metadata, null, 2),
    "utf-8",
  );
  await writeFile(path.join(dir, TEXT_FILENAME), params.extractedText, "utf-8");

  const relativePath = path.join(
    path.basename(storagePath) === "uploads"
      ? path.join("storage", "uploads", params.fileId, originalName)
      : path.join(params.fileId, originalName),
  );

  const record: FileMetadata = {
    ...params.metadata,
    storage_path: params.metadata.storage_path || relativePath,
  };

  const index = await readIndex(storagePath);
  const without = index.filter((f) => f.id !== record.id);
  without.push(record);
  await writeIndex(storagePath, without);

  return record;
}

export async function listFiles(): Promise<FileMetadata[]> {
  const { storagePath } = await ensureStorageDirs();
  return readIndex(storagePath);
}

export async function getFileMetadata(
  fileId: string,
): Promise<FileMetadata | null> {
  const { storagePath } = await ensureStorageDirs();
  const fromIndex = (await readIndex(storagePath)).find((f) => f.id === fileId);
  if (fromIndex) return fromIndex;

  try {
    const raw = await readFile(
      path.join(fileDir(storagePath, fileId), METADATA_FILENAME),
      "utf-8",
    );
    return JSON.parse(raw) as FileMetadata;
  } catch {
    return null;
  }
}

export async function getExtractedText(fileId: string): Promise<string | null> {
  const { storagePath } = await ensureStorageDirs();
  try {
    return await readFile(
      path.join(fileDir(storagePath, fileId), TEXT_FILENAME),
      "utf-8",
    );
  } catch {
    return null;
  }
}

/** Write/replace extracted.txt for an existing upload (reparse). */
export async function saveExtractedText(
  fileId: string,
  text: string,
): Promise<void> {
  const { storagePath } = await ensureStorageDirs();
  const dir = fileDir(storagePath, fileId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, TEXT_FILENAME), text, "utf-8");
}

/** Read original uploaded bytes from uploads/{id}/original.{ext}. */
export async function getOriginalFileBuffer(
  fileId: string,
  filename?: string,
): Promise<Buffer | null> {
  const { storagePath } = await ensureStorageDirs();
  const dir = fileDir(storagePath, fileId);

  if (filename) {
    const ext = path.extname(filename).toLowerCase();
    try {
      return await readFile(path.join(dir, `${ORIGINAL_BASENAME}${ext}`));
    } catch {
      /* fall through to directory scan */
    }
  }

  try {
    const entries = await readdir(dir);
    const original = entries.find(
      (name) =>
        name === ORIGINAL_BASENAME || name.startsWith(`${ORIGINAL_BASENAME}.`),
    );
    if (!original) return null;
    return await readFile(path.join(dir, original));
  } catch {
    return null;
  }
}

export async function deleteFile(
  fileId: string,
): Promise<{ deleted: boolean; chunks_removed: number }> {
  const { storagePath } = await ensureStorageDirs();
  const existing = await getFileMetadata(fileId);
  if (!existing) {
    return { deleted: false, chunks_removed: 0 };
  }

  // Remove vector DB records first (source of truth for chunks_removed)
  const { deleteFileVectors } = await import("@/lib/vector-db/vector-db");
  const { chunks_removed: fromVectors } = await deleteFileVectors(fileId);
  const chunksRemoved =
    fromVectors > 0 ? fromVectors : (existing.chunks_count ?? 0);

  await rm(fileDir(storagePath, fileId), { recursive: true, force: true });

  const index = await readIndex(storagePath);
  await writeIndex(
    storagePath,
    index.filter((f) => f.id !== fileId),
  );

  // Best-effort: touch directory listing
  try {
    await readdir(storagePath);
  } catch {
    /* ignore */
  }

  return { deleted: true, chunks_removed: chunksRemoved };
}

/** Update file metadata fields (chunks_count / indexed / chunk_config). */
export async function updateFileMetadata(
  fileId: string,
  patch: Partial<
    Pick<FileMetadata, "chunks_count" | "indexed" | "chunk_config" | "metadata">
  >,
): Promise<FileMetadata | null> {
  const { storagePath } = await ensureStorageDirs();
  const existing = await getFileMetadata(fileId);
  if (!existing) return null;

  const updated: FileMetadata = { ...existing, ...patch };
  await writeFile(
    path.join(fileDir(storagePath, fileId), METADATA_FILENAME),
    JSON.stringify(updated, null, 2),
    "utf-8",
  );

  const index = await readIndex(storagePath);
  const without = index.filter((f) => f.id !== fileId);
  without.push(updated);
  await writeIndex(storagePath, without);
  return updated;
}

export function getMaxFileSizeBytes(): number {
  const mb = Number(process.env.MAX_FILE_SIZE_MB ?? "50");
  const safe = Number.isFinite(mb) && mb > 0 ? mb : 50;
  return safe * 1024 * 1024;
}
