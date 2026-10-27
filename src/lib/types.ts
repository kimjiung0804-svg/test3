/** File metadata stored under ./storage/uploads (see spec.json FileMetadata). */
export type FileType = "pdf" | "docx" | "doc" | "xlsx" | "xls";

export interface FileMetadata {
  id: string;
  filename: string;
  file_type: FileType;
  size: number;
  storage_path: string;
  uploaded_at: string;
  chunks_count: number;
  indexed: boolean;
  chunk_config?: {
    chunk_size: number;
    chunk_overlap: number;
  };
  metadata?: Record<string, unknown>;
}

/** Individual text segment from a document (spec.json TextChunk). */
export interface TextChunk {
  id: string;
  file_id: string;
  content: string;
  sequence_number: number;
  start_char: number;
  end_char: number;
  page_number: number | null;
  created_at: string;
}

/** Vector embedding + metadata for a text chunk (spec.json VectorRecord). */
export interface VectorRecord {
  id: string;
  chunk_id: string;
  file_id: string;
  embedding: number[];
  embedding_model: string;
  metadata: {
    filename: string;
    chunk_sequence: number;
    page_number: number | null;
    file_type: string;
    content_preview: string;
  };
  indexed_at: string;
}

/** Enriched record returned by /api/vector-inspect. */
export interface VectorInspectChunk extends VectorRecord {
  content: string;
  sequence_number: number;
  start_char?: number;
  end_char?: number;
  page_number: number | null;
  similarity_score?: number;
}

export const ACCEPTED_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".doc",
  ".xlsx",
  ".xls",
] as const;

export function extensionToFileType(ext: string): FileType | null {
  const normalized = ext.toLowerCase().replace(/^\./, "");
  switch (normalized) {
    case "pdf":
    case "docx":
    case "doc":
    case "xlsx":
    case "xls":
      return normalized;
    default:
      return null;
  }
}
