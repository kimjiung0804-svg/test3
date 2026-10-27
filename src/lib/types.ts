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
