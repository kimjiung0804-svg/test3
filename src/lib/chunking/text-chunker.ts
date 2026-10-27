export interface ChunkSlice {
  content: string;
  sequence_number: number;
  start_char: number;
  end_char: number;
  page_number: number | null;
  /** XLSX sheet name inferred from `# Sheet:` markers. */
  sheet_name: string | null;
  /** XLSX/data row number inferred from `Row N:` markers. */
  row_number: number | null;
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
 * Infers page / sheet / row metadata from extract markers.
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
      const loc = inferLocationMeta(normalized, start, content);
      chunks.push({
        content,
        sequence_number: sequence,
        start_char: start,
        end_char: end,
        page_number: loc.page_number,
        sheet_name: loc.sheet_name,
        row_number: loc.row_number,
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

export interface LocationMeta {
  page_number: number | null;
  sheet_name: string | null;
  row_number: number | null;
}

/**
 * Infer page / sheet / row from form-feed, Page markers, and XLSX extract markers
 * (`# Sheet: Name`, `Row N:`).
 */
export function inferLocationMeta(
  fullText: string,
  charOffset: number,
  chunkContent?: string,
): LocationMeta {
  const prefix = fullText.slice(0, charOffset + 1);
  const window = chunkContent ?? "";

  let page_number: number | null = null;
  const formFeeds = prefix.split("\f").length - 1;
  if (formFeeds > 0) {
    page_number = formFeeds + 1;
  } else {
    const pageMarkers = [
      ...prefix.matchAll(/(?:^|\n)\s*(?:#\s*)?Page\s+(\d+)/gi),
    ];
    if (pageMarkers.length > 0) {
      const last = pageMarkers[pageMarkers.length - 1];
      const n = Number(last![1]);
      page_number = Number.isFinite(n) ? n : null;
    }
  }

  // Sheet name: prefer marker inside the chunk, else last marker before offset.
  let sheet_name: string | null = null;
  const sheetInChunk = [
    ...window.matchAll(/(?:^|\n)\s*#\s*Sheet:\s*(.+)/gi),
  ];
  if (sheetInChunk.length > 0) {
    sheet_name = sheetInChunk[0]![1]!.trim() || null;
  } else {
    const sheetBefore = [
      ...prefix.matchAll(/(?:^|\n)\s*#\s*Sheet:\s*(.+)/gi),
    ];
    if (sheetBefore.length > 0) {
      sheet_name =
        sheetBefore[sheetBefore.length - 1]![1]!.trim() || null;
    }
  }

  // Row number: first Row N in chunk, else last Row N within the current sheet section.
  let row_number: number | null = null;
  const rowInChunk = [...window.matchAll(/(?:^|\n)\s*Row\s+(\d+)\s*:/gi)];
  if (rowInChunk.length > 0) {
    const n = Number(rowInChunk[0]![1]);
    row_number = Number.isFinite(n) ? n : null;
  } else {
    const lastSheetIdx = Math.max(
      prefix.lastIndexOf("\n# Sheet:"),
      prefix.lastIndexOf("# Sheet:"),
      0,
    );
    const sheetSection = prefix.slice(lastSheetIdx);
    const rowBefore = [
      ...sheetSection.matchAll(/(?:^|\n)\s*Row\s+(\d+)\s*:/gi),
    ];
    if (rowBefore.length > 0) {
      const n = Number(rowBefore[rowBefore.length - 1]![1]);
      row_number = Number.isFinite(n) ? n : null;
    }
  }

  // When sheet markers exist but no PDF page, use 1-based sheet ordinal as page_number.
  if (page_number == null && sheet_name != null) {
    const sheetMarkers = [
      ...prefix.matchAll(/(?:^|\n)\s*#\s*Sheet:\s*.+/gi),
    ];
    if (sheetMarkers.length > 0) page_number = sheetMarkers.length;
  }

  return { page_number, sheet_name, row_number };
}
