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
  /** XLSX sheet name when row-aware chunking applied. */
  sheet_name?: string | null;
  /** XLSX / tabular row index when row-aware chunking applied. */
  row_number?: number | null;
  /** 업체명 / company value when present in the row. */
  company_name?: string | null;
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
    /** Alias used by Vector Inspector / RAG filters (XLSX). */
    sheet: string | null;
    /** Alias used by Vector Inspector / RAG filters (XLSX row). */
    row: number | null;
    /** 업체명 when parsed from row pairs. */
    company_name: string | null;
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
  sheet_name?: string | null;
  row_number?: number | null;
  company_name?: string | null;
  similarity_score?: number;
}

/** Source chunk metadata returned with RAG chat responses (spec CitationData). */
export interface CitationData {
  chunk_id: string;
  file_id: string;
  filename: string;
  similarity_score: number;
  page_number: number | null;
  content_preview?: string;
  sequence_number?: number;
}

/** Conversation history record (spec ChatMessage). */
export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations?: CitationData[];
  tokens_used?: number | null;
  created_at: string;
}

/** SSE payload shapes for /api/chat streaming. */
export type ChatStreamEvent =
  | { type: "citations"; citations: CitationData[] }
  | { type: "chunk"; content: string }
  | { type: "done"; done: true; conversation_id: string; message_id?: string }
  | { type: "error"; error: string; message: string };

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
