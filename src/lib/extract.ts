import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import * as XLSX from "xlsx";
import type { FileType } from "./types";

export interface ExtractResult {
  text: string;
  metadata?: Record<string, unknown>;
}

/** One self-contained spreadsheet data row (header:value pairs). */
export interface SpreadsheetExtractedRow {
  sheet: string;
  /** 1-based Excel row number (including title/header rows above). */
  row_index: number;
  headers: string[];
  fields: Record<string, string>;
  /** Search/embed friendly line, e.g. `[Sheet: A] Row 298 | No: 298 | 업체명: 삼성전자` */
  text: string;
}

export interface SpreadsheetSheetSummary {
  name: string;
  header_row_index: number;
  headers: string[];
  row_count: number;
  non_empty_cells: number;
}

/** Extract raw text from PDF / DOCX / XLSX buffers. */
export async function extractText(
  buffer: Buffer,
  fileType: FileType,
): Promise<ExtractResult> {
  switch (fileType) {
    case "pdf":
      return extractPdf(buffer);
    case "docx":
    case "doc":
      return extractDocx(buffer);
    case "xlsx":
    case "xls":
      return extractXlsx(buffer);
    default: {
      const _exhaustive: never = fileType;
      throw new Error(`Unsupported file type: ${_exhaustive}`);
    }
  }
}

async function extractPdf(buffer: Buffer): Promise<ExtractResult> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return {
      text: result.text ?? "",
      metadata: { page_count: result.total ?? result.pages?.length },
    };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function extractDocx(buffer: Buffer): Promise<ExtractResult> {
  const result = await mammoth.extractRawText({ buffer });
  return {
    text: result.value ?? "",
    metadata: {
      messages: result.messages?.map((m) => ({
        type: m.type,
        message: m.message,
      })),
    },
  };
}

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return String(value);
}

function normalizeHeader(raw: string, colIndex: number): string {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned || /^__EMPTY/i.test(cleaned)) {
    return `Column_${colIndex + 1}`;
  }
  return cleaned;
}

function isRowEmpty(row: unknown[] | undefined): boolean {
  if (!row || row.length === 0) return true;
  return !row.some((c) => cellToString(c).replace(/\s+/g, " ").trim());
}

/** Column labels commonly found in exhibitor / SEDEX-style sheets. */
const HEADER_HINT_PATTERNS: RegExp[] = [
  /^no\.?$/i,
  /^번호$/,
  /순번/,
  /업체명/,
  /회사명/,
  /기업명/,
  /상호/,
  /부스위치/,
  /부스\s*번호/,
  /부스번호/,
  /^부스$/,
  /참가/,
  /국가/,
  /업종/,
  /^name$/i,
  /^company$/i,
  /booth/i,
  /^country$/i,
];

function scoreHeaderRow(cells: string[]): number {
  const nonEmpty = cells.map((c) => c.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (nonEmpty.length < 2) return -10;

  let score = 0;
  for (const cell of nonEmpty) {
    if (HEADER_HINT_PATTERNS.some((re) => re.test(cell))) score += 4;
    // Short label-like cells look like headers
    if (cell.length <= 24 && !/^\d+([.]\d+)?$/.test(cell)) score += 1;
    // Long prose / title banners are unlikely column headers
    if (cell.length > 40) score -= 3;
  }

  const numericRatio =
    nonEmpty.filter((c) => /^\d+([.]\d+)?$/.test(c)).length / nonEmpty.length;
  score -= numericRatio * 6;

  return score;
}

/**
 * Pick the header row within the first rows of a sheet.
 * Prefers rows containing labels like No / 업체명 / 부스위치.
 */
function findHeaderRowIndex(matrix: unknown[][]): number {
  const scanLimit = Math.min(matrix.length, 40);
  let bestIdx = -1;
  let bestScore = -Infinity;

  for (let i = 0; i < scanLimit; i++) {
    if (isRowEmpty(matrix[i])) continue;
    const cells = (matrix[i] ?? []).map((c) => cellToString(c));
    const score = scoreHeaderRow(cells);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  if (bestIdx >= 0 && bestScore >= 3) return bestIdx;

  // Fallback: first non-empty row
  for (let i = 0; i < matrix.length; i++) {
    if (!isRowEmpty(matrix[i])) return i;
  }
  return 0;
}

function formatRowText(
  sheetName: string,
  excelRowIndex: number,
  pairs: string[],
): string {
  return `[Sheet: ${sheetName}] Row ${excelRowIndex} | ${pairs.join(" | ")}`;
}

/**
 * Parse row lines emitted by extractXlsx back into structured rows
 * (used by preview API for row-level inspection).
 */
export function parseSpreadsheetPreviewRows(
  text: string,
): SpreadsheetExtractedRow[] {
  const rows: SpreadsheetExtractedRow[] = [];
  const lineRe =
    /^\[Sheet:\s*(.+?)\]\s*Row\s+(\d+)\s*\|\s*(.+)$/;

  for (const block of text.split(/\n+/)) {
    const line = block.trim();
    if (!line) continue;
    const m = line.match(lineRe);
    if (!m) continue;

    const sheet = m[1]!.trim();
    const row_index = Number(m[2]);
    const pairsRaw = m[3]!;
    const fields: Record<string, string> = {};
    const headers: string[] = [];

    for (const part of pairsRaw.split(/\s*\|\s*/)) {
      const idx = part.indexOf(":");
      if (idx <= 0) continue;
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (!key) continue;
      headers.push(key);
      fields[key] = value;
    }

    rows.push({
      sheet,
      row_index,
      headers,
      fields,
      text: line,
    });
  }

  return rows;
}

/**
 * Extract XLSX/XLS as embedding-friendly structured text:
 * detected header row + header:value pairs per data row (not raw CSV).
 */
function extractXlsx(buffer: Buffer): ExtractResult {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    cellNF: false,
    cellText: true,
  });

  const parts: string[] = [];
  const allRows: SpreadsheetExtractedRow[] = [];
  const sheetSummaries: SpreadsheetSheetSummary[] = [];
  let totalRows = 0;
  let totalCells = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    parts.push(`# Sheet: ${sheetName}`);

    // Keep blank rows so indices align with Excel 1-based row numbers.
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
      blankrows: true,
    });

    if (!matrix.length || matrix.every((r) => isRowEmpty(r))) {
      parts.push("(empty sheet)");
      sheetSummaries.push({
        name: sheetName,
        header_row_index: 0,
        headers: [],
        row_count: 0,
        non_empty_cells: 0,
      });
      continue;
    }

    const headerIdx = findHeaderRowIndex(matrix);
    const headerCells = (matrix[headerIdx] ?? []).map((c) => cellToString(c));
    const headers = headerCells.map((h, i) => normalizeHeader(h, i));
    const excelHeaderRow = headerIdx + 1;

    parts.push(
      `# Headers (Excel row ${excelHeaderRow}): ${headers.join(" | ")}`,
    );

    let sheetRows = 0;
    let sheetCells = 0;
    const dataStart = headerIdx + 1;

    if (dataStart < matrix.length) {
      for (let r = dataStart; r < matrix.length; r++) {
        const row = matrix[r] ?? [];
        if (isRowEmpty(row)) continue;

        const pairs: string[] = [];
        const fields: Record<string, string> = {};
        const width = Math.max(headers.length, row.length);

        for (let c = 0; c < width; c++) {
          const header = headers[c] ?? `Column_${c + 1}`;
          const value = cellToString(row[c]).replace(/\s+/g, " ").trim();
          if (!value) continue;
          pairs.push(`${header}: ${value}`);
          fields[header] = value;
          sheetCells += 1;
        }

        if (pairs.length === 0) continue;

        const excelRow = r + 1;
        const rowText = formatRowText(sheetName, excelRow, pairs);
        parts.push(rowText);
        allRows.push({
          sheet: sheetName,
          row_index: excelRow,
          headers,
          fields,
          text: rowText,
        });
        sheetRows += 1;
      }
    } else {
      // Only a header-like row: emit it as values so content is not lost.
      const pairs: string[] = [];
      const fields: Record<string, string> = {};
      for (let c = 0; c < headerCells.length; c++) {
        const value = headerCells[c]!.replace(/\s+/g, " ").trim();
        if (!value) continue;
        const key = `Column_${c + 1}`;
        pairs.push(`${key}: ${value}`);
        fields[key] = value;
        sheetCells += 1;
      }
      if (pairs.length > 0) {
        const rowText = formatRowText(sheetName, excelHeaderRow, pairs);
        parts.push(rowText);
        allRows.push({
          sheet: sheetName,
          row_index: excelHeaderRow,
          headers: Object.keys(fields),
          fields,
          text: rowText,
        });
        sheetRows = 1;
      } else {
        parts.push("(empty sheet)");
      }
    }

    // Fallback: if header-row mode produced nothing, dump every non-empty cell.
    if (sheetRows === 0) {
      for (let r = 0; r < matrix.length; r++) {
        const row = matrix[r] ?? [];
        if (isRowEmpty(row)) continue;
        const pairs: string[] = [];
        const fields: Record<string, string> = {};
        for (let c = 0; c < row.length; c++) {
          const value = cellToString(row[c]).replace(/\s+/g, " ").trim();
          if (!value) continue;
          const key = `Column_${c + 1}`;
          pairs.push(`${key}: ${value}`);
          fields[key] = value;
          sheetCells += 1;
        }
        if (pairs.length === 0) continue;
        const excelRow = r + 1;
        const rowText = formatRowText(sheetName, excelRow, pairs);
        parts.push(rowText);
        allRows.push({
          sheet: sheetName,
          row_index: excelRow,
          headers: Object.keys(fields),
          fields,
          text: rowText,
        });
        sheetRows += 1;
      }
    }

    totalRows += sheetRows;
    totalCells += sheetCells;
    sheetSummaries.push({
      name: sheetName,
      header_row_index: excelHeaderRow,
      headers,
      row_count: sheetRows,
      non_empty_cells: sheetCells,
    });
  }

  const text = parts.join("\n\n").trim();

  return {
    text,
    metadata: {
      sheet_names: workbook.SheetNames,
      sheet_count: workbook.SheetNames.length,
      data_row_count: totalRows,
      non_empty_cell_count: totalCells,
      sheets: sheetSummaries,
      extract_format: "header_row_pairs",
      // Compact row list for preview / downstream chunkers (no duplicate text blob).
      rows: allRows.map((r) => ({
        sheet: r.sheet,
        row_index: r.row_index,
        fields: r.fields,
        text: r.text,
      })),
    },
  };
}
