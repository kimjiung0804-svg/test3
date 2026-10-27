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

function extractXlsx(buffer: Buffer): ExtractResult {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const parts: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    parts.push(`# Sheet: ${sheetName}`);
    parts.push(XLSX.utils.sheet_to_csv(sheet));
  }

  return {
    text: parts.join("\n\n").trim(),
    metadata: {
      sheet_names: workbook.SheetNames,
      sheet_count: workbook.SheetNames.length,
    },
  };
}
