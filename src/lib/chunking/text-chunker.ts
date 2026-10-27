export interface ChunkSlice {
  content: string;
  sequence_number: number;
  start_char: number;
  end_char: number;
  page_number: number | null;
  /** XLSX sheet name when row-aware / extract markers are present. */
  sheet_name: string | null;
  /** Excel row index covered by this chunk. */
  row_number: number | null;
  /** Company / 업체명 value when present in the row pairs. */
  company_name: string | null;
  /** Chunking strategy used for this slice. */
  chunk_strategy?: "char_window" | "xlsx_row";
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

/** New extract format: `[Sheet: Name] Row 298 | 업체명: 삼성전자 | …` */
const NEW_ROW_LINE_RE =
  /^\[Sheet:\s*(.+?)\]\s*Row\s+(\d+)\s*\|\s*(.+)$/;

/** Legacy extract format: `Row 298: 업체명: 삼성전자 | …` */
const LEGACY_ROW_LINE_RE = /^Row\s+(\d+)\s*:\s*(.+)$/i;

/** True when extract text looks like XLSX header_row_pairs output. */
export function isXlsxRowExtract(text: string): boolean {
  const hasSheet = /(?:^|\n)\s*#\s*Sheet:\s*.+/i.test(text);
  const hasNewRow = /(?:^|\n)\s*\[Sheet:\s*.+?\]\s*Row\s+\d+\s*\|/i.test(
    text,
  );
  const hasLegacyRow = /(?:^|\n)\s*Row\s+\d+\s*:/i.test(text);
  return hasNewRow || (hasSheet && hasLegacyRow);
}

/**
 * Split document text into chunks.
 * XLSX `header_row_pairs` extracts use row-aware packing (never mid-row cuts);
 * other documents use overlapping character windows.
 */
export function chunkText(
  text: string,
  options: ChunkOptions,
): ChunkSlice[] {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.trim()) return [];

  if (isXlsxRowExtract(normalized)) {
    return chunkXlsxRows(normalized, options);
  }
  return chunkByCharacters(normalized, options);
}

interface ParsedXlsxRow {
  rowNumber: number;
  sheetName: string;
  /** Full self-contained row line from extract. */
  line: string;
  /** header:value body only (after Row N | or Row N:). */
  body: string;
  startChar: number;
  endChar: number;
  companyName: string | null;
  headers: string[];
}

interface ParsedXlsxSheet {
  name: string;
  sheetIndex: number;
  headerLine: string;
  rows: ParsedXlsxRow[];
}

function extractCompanyName(rowBody: string): string | null {
  const patterns = [
    /(?:^|\|\s*)업체명\s*:\s*([^|]+)/i,
    /(?:^|\|\s*)회사명\s*:\s*([^|]+)/i,
    /(?:^|\|\s*)기업명\s*:\s*([^|]+)/i,
    /(?:^|\|\s*)company(?:\s*name)?\s*:\s*([^|]+)/i,
  ];
  for (const re of patterns) {
    const m = rowBody.match(re);
    if (m?.[1]) {
      const v = m[1].replace(/\s+/g, " ").trim();
      if (v) return v;
    }
  }
  return null;
}

function extractHeadersFromRowBody(rowBody: string): string[] {
  const headers: string[] = [];
  for (const part of rowBody.split("|")) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).replace(/\s+/g, " ").trim();
    if (key) headers.push(key);
  }
  return headers;
}

function parseXlsxSheets(text: string): ParsedXlsxSheet[] {
  // Fast path: new self-contained rows — group by sheet name.
  const newRows: ParsedXlsxRow[] = [];
  const lines = text.split("\n");
  let offset = 0;
  const sheetHeaderByName = new Map<string, string>();

  let currentSheetFromMarker: string | null = null;
  let currentHeadersFromMarker = "";
  let sheetOrdinal = 0;
  const sheetIndexByName = new Map<string, number>();

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    const lineStart = offset;
    const lineEnd = offset + rawLine.length;
    offset += rawLine.length + 1; // + '\n'

    const sheetMarker = trimmed.match(/^#\s*Sheet:\s*(.+)$/i);
    if (sheetMarker) {
      currentSheetFromMarker = sheetMarker[1]!.trim();
      if (currentSheetFromMarker && !sheetIndexByName.has(currentSheetFromMarker)) {
        sheetOrdinal += 1;
        sheetIndexByName.set(currentSheetFromMarker, sheetOrdinal);
      }
      continue;
    }

    const headersMarker = trimmed.match(
      /^#\s*Headers(?:\s*\(Excel row \d+\))?:\s*(.+)$/i,
    );
    if (headersMarker) {
      currentHeadersFromMarker = `Headers: ${headersMarker[1]!.trim()}`;
      if (currentSheetFromMarker) {
        sheetHeaderByName.set(
          currentSheetFromMarker,
          currentHeadersFromMarker,
        );
      }
      continue;
    }

    const newMatch = trimmed.match(NEW_ROW_LINE_RE);
    if (newMatch) {
      const sheetName = newMatch[1]!.trim();
      const rowNumber = Number(newMatch[2]);
      const body = newMatch[3]!.trim();
      if (!Number.isFinite(rowNumber) || !body) continue;
      if (!sheetIndexByName.has(sheetName)) {
        sheetOrdinal += 1;
        sheetIndexByName.set(sheetName, sheetOrdinal);
      }
      if (currentHeadersFromMarker && !sheetHeaderByName.has(sheetName)) {
        sheetHeaderByName.set(sheetName, currentHeadersFromMarker);
      }
      newRows.push({
        rowNumber,
        sheetName,
        line: trimmed,
        body,
        startChar: lineStart + (rawLine.length - line.length),
        endChar: lineEnd,
        companyName: extractCompanyName(body),
        headers: extractHeadersFromRowBody(body),
      });
      continue;
    }

    const legacyMatch = trimmed.match(LEGACY_ROW_LINE_RE);
    if (legacyMatch && currentSheetFromMarker) {
      const rowNumber = Number(legacyMatch[1]);
      const body = legacyMatch[2]!.trim();
      if (!Number.isFinite(rowNumber) || !body) continue;
      const sheetName = currentSheetFromMarker;
      if (!sheetIndexByName.has(sheetName)) {
        sheetOrdinal += 1;
        sheetIndexByName.set(sheetName, sheetOrdinal);
      }
      // Normalize legacy lines to the self-contained form used in chunks.
      const normalizedLine = `[Sheet: ${sheetName}] Row ${rowNumber} | ${body}`;
      newRows.push({
        rowNumber,
        sheetName,
        line: normalizedLine,
        body,
        startChar: lineStart + (rawLine.length - line.length),
        endChar: lineEnd,
        companyName: extractCompanyName(body),
        headers: extractHeadersFromRowBody(body),
      });
    }
  }

  if (newRows.length === 0) return [];

  const bySheet = new Map<string, ParsedXlsxRow[]>();
  for (const row of newRows) {
    const list = bySheet.get(row.sheetName) ?? [];
    list.push(row);
    bySheet.set(row.sheetName, list);
  }

  const sheets: ParsedXlsxSheet[] = [];
  for (const [name, rows] of bySheet) {
    const headerKeys =
      sheetHeaderByName.get(name) ||
      (rows.find((r) => r.headers.length > 0)
        ? `Headers: ${rows.find((r) => r.headers.length > 0)!.headers.join(" | ")}`
        : "");
    sheets.push({
      name,
      sheetIndex: sheetIndexByName.get(name) ?? sheets.length + 1,
      headerLine: headerKeys,
      rows,
    });
  }

  return sheets;
}

/**
 * Pack complete XLSX rows into self-contained chunks with repeated sheet +
 * header context. Never splits a single Row line across chunks.
 *
 * Default (chunkSize ≤ 1000): one data row per chunk so rowIndex / 업체명
 * metadata stay exact. Larger sizes may pack a few whole rows.
 */
export function chunkXlsxRows(
  text: string,
  options: ChunkOptions,
): ChunkSlice[] {
  const { chunkSize, chunkOverlap } = options;
  const sheets = parseXlsxSheets(text);
  if (sheets.length === 0) {
    return chunkByCharacters(text, options);
  }

  const chunks: ChunkSlice[] = [];
  let sequence = 0;

  const preferSingleRow = chunkSize <= 1000;
  const overlapRows =
    !preferSingleRow && chunkOverlap > 0
      ? Math.max(1, Math.min(2, Math.round(chunkOverlap / 120)))
      : 0;

  for (const sheet of sheets) {
    if (sheet.rows.length === 0) continue;

    const prefixLines = [`# Sheet: ${sheet.name}`];
    if (sheet.headerLine) prefixLines.push(sheet.headerLine);
    const prefix = prefixLines.join("\n");

    let startIdx = 0;
    while (startIdx < sheet.rows.length) {
      const group: ParsedXlsxRow[] = [];
      let bodyLen = 0;
      let endIdx = startIdx;

      while (endIdx < sheet.rows.length) {
        const row = sheet.rows[endIdx]!;
        const nextLen =
          prefix.length +
          1 +
          bodyLen +
          (group.length > 0 ? 1 : 0) +
          row.line.length;

        if (group.length > 0 && (preferSingleRow || nextLen > chunkSize)) {
          break;
        }

        group.push(row);
        bodyLen += (group.length > 1 ? 1 : 0) + row.line.length;
        endIdx += 1;

        if (group.length === 1 && (preferSingleRow || nextLen > chunkSize)) {
          break;
        }
      }

      if (group.length === 0) break;

      const content = `${prefix}\n${group.map((r) => r.line).join("\n")}`;
      const first = group[0]!;
      const last = group[group.length - 1]!;
      const companyRow =
        group.find((r) => r.companyName != null) ?? first;

      chunks.push({
        content,
        sequence_number: sequence,
        start_char: first.startChar,
        end_char: last.endChar,
        page_number: sheet.sheetIndex,
        sheet_name: sheet.name,
        row_number: preferSingleRow
          ? first.rowNumber
          : companyRow.rowNumber,
        company_name: companyRow.companyName,
        chunk_strategy: "xlsx_row",
      });
      sequence += 1;

      if (endIdx >= sheet.rows.length) break;

      const nextStart = endIdx - Math.min(overlapRows, group.length - 1);
      startIdx = Math.max(startIdx + 1, nextStart);
    }
  }

  return chunks;
}

function chunkByCharacters(
  normalized: string,
  options: ChunkOptions,
): ChunkSlice[] {
  const { chunkSize, chunkOverlap } = options;
  const chunks: ChunkSlice[] = [];
  let start = 0;
  let sequence = 0;
  const step = Math.max(1, chunkSize - chunkOverlap);

  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);

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
        company_name: loc.company_name,
        chunk_strategy: "char_window",
      });
      sequence += 1;
    }

    if (end >= normalized.length) break;
    start += step;
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
  company_name: string | null;
}

/**
 * Infer page / sheet / row / company from form-feed, Page markers, and XLSX
 * extract markers (`# Sheet:`, `[Sheet:] Row N |`, `Row N:`).
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

  let sheet_name: string | null = null;
  const sheetInChunkNew = [
    ...window.matchAll(/\[Sheet:\s*(.+?)\]/gi),
  ];
  if (sheetInChunkNew.length > 0) {
    sheet_name = sheetInChunkNew[0]![1]!.trim() || null;
  } else {
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
  }

  let row_number: number | null = null;
  const rowNew = [
    ...window.matchAll(/\[Sheet:\s*.+?\]\s*Row\s+(\d+)\s*\|/gi),
  ];
  if (rowNew.length > 0) {
    const n = Number(rowNew[0]![1]);
    row_number = Number.isFinite(n) ? n : null;
  } else {
    const rowInChunk = [...window.matchAll(/(?:^|\n)\s*Row\s+(\d+)\s*:/gi)];
    if (rowInChunk.length > 0) {
      const n = Number(rowInChunk[0]![1]);
      row_number = Number.isFinite(n) ? n : null;
    }
  }

  if (page_number == null && sheet_name != null) {
    const sheetMarkers = [
      ...prefix.matchAll(/(?:^|\n)\s*#\s*Sheet:\s*.+/gi),
    ];
    if (sheetMarkers.length > 0) page_number = sheetMarkers.length;
  }

  const company_name =
    extractCompanyName(window) ?? extractCompanyName(prefix.slice(-500));

  return { page_number, sheet_name, row_number, company_name };
}
