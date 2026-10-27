import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import * as XLSX from "xlsx";
import type { FileType } from "./types";

export interface ExtractResult {
  text: string;
  metadata?: Record<string, unknown>;
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

/**
 * Extract XLSX/XLS as embedding-friendly structured text:
 * sheet name + header:value pairs per data row (not raw CSV).
 */
function extractXlsx(buffer: Buffer): ExtractResult {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    cellNF: false,
    cellText: true,
  });

  const parts: string[] = [];
  const sheetSummaries: Array<{
    name: string;
    row_count: number;
    non_empty_cells: number;
  }> = [];
  let totalRows = 0;
  let totalCells = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    parts.push(`# Sheet: ${sheetName}`);

    // Array-of-arrays preserves column order; raw:false prefers formatted text.
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
      blankrows: false,
    });

    if (!matrix.length) {
      parts.push("(empty sheet)");
      sheetSummaries.push({
        name: sheetName,
        row_count: 0,
        non_empty_cells: 0,
      });
      continue;
    }

    const headerCells = (matrix[0] ?? []).map((c) => cellToString(c));
    const hasMultipleRows = matrix.length > 1;
    const headers = headerCells.map((h, i) => normalizeHeader(h, i));

    let sheetRows = 0;
    let sheetCells = 0;

    if (hasMultipleRows) {
      for (let r = 1; r < matrix.length; r++) {
        const row = matrix[r] ?? [];
        const pairs: string[] = [];
        const width = Math.max(headers.length, row.length);

        for (let c = 0; c < width; c++) {
          const header = headers[c] ?? `Column_${c + 1}`;
          const value = cellToString(row[c]).replace(/\s+/g, " ").trim();
          if (!value) continue;
          pairs.push(`${header}: ${value}`);
          sheetCells += 1;
        }

        if (pairs.length === 0) continue;
        parts.push(`Row ${r}: ${pairs.join(" | ")}`);
        sheetRows += 1;
      }
    } else {
      // Single row: treat cells as values (no header pairing) so content is not lost.
      const pairs: string[] = [];
      for (let c = 0; c < headerCells.length; c++) {
        const value = headerCells[c]!.replace(/\s+/g, " ").trim();
        if (!value) continue;
        pairs.push(`Column_${c + 1}: ${value}`);
        sheetCells += 1;
      }
      if (pairs.length > 0) {
        parts.push(`Row 1: ${pairs.join(" | ")}`);
        sheetRows = 1;
      } else {
        parts.push("(empty sheet)");
      }
    }

    // Fallback: if header-row mode produced nothing, dump every non-empty cell.
    if (sheetRows === 0 && matrix.length > 1) {
      for (let r = 0; r < matrix.length; r++) {
        const row = matrix[r] ?? [];
        const pairs: string[] = [];
        for (let c = 0; c < row.length; c++) {
          const value = cellToString(row[c]).replace(/\s+/g, " ").trim();
          if (!value) continue;
          pairs.push(`Column_${c + 1}: ${value}`);
          sheetCells += 1;
        }
        if (pairs.length === 0) continue;
        parts.push(`Row ${r + 1}: ${pairs.join(" | ")}`);
        sheetRows += 1;
      }
    }

    totalRows += sheetRows;
    totalCells += sheetCells;
    sheetSummaries.push({
      name: sheetName,
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
    },
  };
}
