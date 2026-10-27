export interface ChunkSlice {
  content: string;
  sequence_number: number;
  start_char: number;
  end_char: number;
  page_number: number | null;
}

export interface ChunkOptions {
  chunkSize: number;
  chunkOverlap: number;
}

const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_CHUNK_OVERLAP = 50;

/** Normalize and validate chunk size / overlap from request or settings. */
export function resolveChunkOptions(
  chunkSize?: number,
  chunkOverlap?: number,
): ChunkOptions {
  const size =
    Number.isFinite(chunkSize) && (chunkSize as number) > 0
      ? Math.floor(chunkSize as number)
      : DEFAULT_CHUNK_SIZE;
  let overlap =
    Number.isFinite(chunkOverlap) && (chunkOverlap as number) >= 0
      ? Math.floor(chunkOverlap as number)
      : DEFAULT_CHUNK_OVERLAP;
  if (overlap >= size) {
    overlap = Math.max(0, size - 1);
  }
  return { chunkSize: size, chunkOverlap: overlap };
}

/**
 * Split text into overlapping character windows.
 * Prefers breaking near whitespace near the window end when possible.
 */
export function chunkText(
  text: string,
  options: ChunkOptions,
): ChunkSlice[] {
  const { chunkSize, chunkOverlap } = options;
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.trim()) return [];

  const chunks: ChunkSlice[] = [];
  let start = 0;
  let sequence = 0;
  const step = Math.max(1, chunkSize - chunkOverlap);

  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);

    // Prefer a whitespace break in the last 20% of the window (when not at EOF)
    if (end < normalized.length) {
      const window = normalized.slice(start, end);
      const searchFrom = Math.floor(window.length * 0.8);
      const tail = window.slice(searchFrom);
      const ws = tail.search(/\s/);
      if (ws >= 0) {
        end = start + searchFrom + ws + 1;
      }
    }

    const content = normalized.slice(start, end);
    if (content.trim().length > 0) {
      chunks.push({
        content,
        sequence_number: sequence,
        start_char: start,
        end_char: end,
        page_number: inferPageNumber(normalized, start),
      });
      sequence += 1;
    }

    if (end >= normalized.length) break;
    start += step;
    // Avoid infinite loop if step somehow stalled
    if (start >= end && end < normalized.length) {
      start = end;
    }
  }

  return chunks;
}

/** Best-effort page/sheet inference from form-feed, "# Page N", or "# Sheet:" markers. */
function inferPageNumber(text: string, charOffset: number): number | null {
  const prefix = text.slice(0, charOffset + 1);
  const formFeeds = prefix.split("\f").length - 1;
  if (formFeeds > 0) return formFeeds + 1;

  const pageMarkers = [...prefix.matchAll(/(?:^|\n)\s*(?:#\s*)?Page\s+(\d+)/gi)];
  if (pageMarkers.length > 0) {
    const last = pageMarkers[pageMarkers.length - 1];
    const n = Number(last[1]);
    return Number.isFinite(n) ? n : null;
  }

  // XLSX extracts use "# Sheet: Name" — map ordinal sheet index as page_number.
  const sheetMarkers = [...prefix.matchAll(/(?:^|\n)\s*#\s*Sheet:\s*.+/gi)];
  if (sheetMarkers.length > 0) return sheetMarkers.length;

  return null;
}
