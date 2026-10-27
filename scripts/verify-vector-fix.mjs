/**
 * Offline verification for ALIGN_VECTOR: XLSX sheet/row chunk metadata +
 * hybrid relevance threshold + filename keyword gate (SEDEX false-positive fix).
 * Run: node scripts/verify-vector-fix.mjs
 */
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function tokenizeQuery(text) {
  const STOPWORDS = new Set([
    "a",
    "an",
    "the",
    "and",
    "or",
    "list",
    "lists",
    "관련",
    "알려",
    "주세요",
  ]);
  const parts = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  return [...new Set(parts)];
}

function computeHybridScore({
  query,
  filename,
  content,
  fileType,
  cosineSimilarity,
}) {
  const tokens = tokenizeQuery(query);
  const filenameLower = filename.toLowerCase();
  const contentLower = content.toLowerCase();
  const matchedFilename = [];
  const matchedContent = [];
  for (const token of tokens) {
    if (filenameLower.includes(token)) matchedFilename.push(token);
    else if (contentLower.includes(token)) matchedContent.push(token);
  }
  const filename_boost = Math.min(0.5, matchedFilename.length * 0.2);
  const contentHitRatio =
    tokens.length === 0 ? 0 : matchedContent.length / tokens.length;
  const content_boost = Math.min(0.22, contentHitRatio * 0.28);
  let typeBoost = 0;
  const excelHint =
    /\b(xlsx|xls|excel|sedex|시트|참가사|명단|리스트|spreadsheet)\b/i;
  const ft = (fileType || "").toLowerCase();
  if (excelHint.test(query) && (ft === "xlsx" || ft === "xls")) typeBoost = 0.1;
  if (
    tokens.length > 0 &&
    matchedFilename.length === 0 &&
    matchedContent.length === 0
  ) {
    typeBoost -= 0.18;
  }
  return {
    final_score: cosineSimilarity + filename_boost + content_boost + typeBoost,
    matched_tokens: [...new Set([...matchedFilename, ...matchedContent])],
    filename_hit: matchedFilename.length > 0,
  };
}

function inferLocationMeta(fullText, charOffset, chunkContent = "") {
  const prefix = fullText.slice(0, charOffset + 1);
  let sheet_name = null;
  const sheetInChunk = [
    ...chunkContent.matchAll(/(?:^|\n)\s*#\s*Sheet:\s*(.+)/gi),
  ];
  if (sheetInChunk.length > 0) sheet_name = sheetInChunk[0][1].trim();
  else {
    const sheetBefore = [...prefix.matchAll(/(?:^|\n)\s*#\s*Sheet:\s*(.+)/gi)];
    if (sheetBefore.length)
      sheet_name = sheetBefore[sheetBefore.length - 1][1].trim();
  }
  let row_number = null;
  const rowInChunk = [...chunkContent.matchAll(/(?:^|\n)\s*Row\s+(\d+)\s*:/gi)];
  if (rowInChunk.length) row_number = Number(rowInChunk[0][1]);
  else {
    const rowBefore = [...prefix.matchAll(/(?:^|\n)\s*Row\s+(\d+)\s*:/gi)];
    if (rowBefore.length)
      row_number = Number(rowBefore[rowBefore.length - 1][1]);
  }
  return { sheet_name, row_number };
}

function chunkText(text, { chunkSize = 500, chunkOverlap = 50 } = {}) {
  const normalized = text.replace(/\r\n/g, "\n");
  const chunks = [];
  let start = 0;
  let sequence = 0;
  const step = Math.max(1, chunkSize - chunkOverlap);
  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);
    const content = normalized.slice(start, end);
    if (content.trim()) {
      const loc = inferLocationMeta(normalized, start, content);
      chunks.push({ content, sequence_number: sequence, ...loc });
      sequence += 1;
    }
    if (end >= normalized.length) break;
    start += step;
    if (start >= end && end < normalized.length) start = end;
  }
  return chunks;
}

function applyKeywordGate(ranked) {
  const hasFilenameHit = ranked.some((r) => r.filename_hit);
  if (!hasFilenameHit) {
    return { kept: ranked, gated: [], keyword_gate_applied: false };
  }
  return {
    kept: ranked.filter((r) => (r.matched_tokens?.length ?? 0) > 0),
    gated: ranked.filter((r) => (r.matched_tokens?.length ?? 0) === 0),
    keyword_gate_applied: true,
  };
}

// --- Tests ---
const sampleXlsx = `# Sheet: 참가사

Row 1: 회사명: SEDEX Korea | 구분: 참가사
Row 2: 회사명: Enable Design | 구분: 참가사

# Sheet: 요약

Row 1: 항목: 총 참가사 | 값: 2`;

const chunks = chunkText(sampleXlsx, { chunkSize: 120, chunkOverlap: 20 });
const withSheet = chunks.filter((c) => c.sheet_name);
const withRow = chunks.filter((c) => c.row_number != null);

console.log("chunks:", chunks.length);
console.log(
  "sample meta:",
  chunks.slice(0, 3).map((c) => ({
    sheet: c.sheet_name,
    row: c.row_number,
    preview: c.content.slice(0, 60).replace(/\n/g, "\\n"),
  })),
);

if (withSheet.length === 0) {
  console.error("FAIL: no sheet_name metadata on chunks");
  process.exit(1);
}
if (withRow.length === 0) {
  console.error("FAIL: no row_number metadata on chunks");
  process.exit(1);
}

const query = "SEDEX 참가사 리스트";
const sedexXlsx = computeHybridScore({
  query,
  filename: "SEDEX_참가사_리스트.xlsx",
  content: "Row 1: 회사명: SEDEX Korea | 구분: 참가사",
  fileType: "xlsx",
  cosineSimilarity: 0.42,
});
const unrelatedPdf = computeHybridScore({
  query,
  filename: "경기행복주택_안내.pdf",
  content: "행복주택 입주 자격 및 신청 방법 안내문",
  fileType: "pdf",
  cosineSimilarity: 0.55,
});

console.log(
  "SEDEX xlsx score:",
  sedexXlsx.final_score.toFixed(3),
  sedexXlsx.matched_tokens,
);
console.log(
  "unrelated PDF score:",
  unrelatedPdf.final_score.toFixed(3),
  unrelatedPdf.matched_tokens,
);

const minScore = 0.5;
const ranked = [
  { name: "SEDEX_참가사_리스트.xlsx", ...sedexXlsx },
  { name: "경기행복주택_안내.pdf", ...unrelatedPdf },
].sort((a, b) => b.final_score - a.final_score);

const gate = applyKeywordGate(ranked);
const passed = gate.kept.filter((r) => r.final_score >= minScore);

console.log(
  "ranked:",
  ranked.map((r) => `${r.name}=${r.final_score.toFixed(3)}`),
);
console.log("keyword_gate_applied:", gate.keyword_gate_applied);
console.log(
  "above threshold (after gate):",
  passed.map((r) => r.name),
);
console.log(
  "gated out:",
  gate.gated.map((r) => r.name),
);

if (ranked[0].name !== "SEDEX_참가사_리스트.xlsx") {
  console.error("FAIL: SEDEX XLSX should rank above unrelated PDF");
  process.exit(1);
}
if (unrelatedPdf.final_score >= sedexXlsx.final_score) {
  console.error("FAIL: boost did not demote unrelated PDF relative to SEDEX");
  process.exit(1);
}
if (!gate.keyword_gate_applied) {
  console.error("FAIL: keyword gate should activate when filename hits exist");
  process.exit(1);
}
if (gate.gated.some((r) => r.name.includes("SEDEX"))) {
  console.error("FAIL: SEDEX must not be gated out");
  process.exit(1);
}
if (!gate.gated.some((r) => r.name.includes("경기행복주택"))) {
  console.error("FAIL: unrelated PDF should be keyword-gated out");
  process.exit(1);
}
if (passed.some((r) => r.name.includes("경기행복주택"))) {
  console.error("FAIL: unrelated PDF must not remain above threshold");
  process.exit(1);
}
if (!passed.some((r) => r.name.includes("SEDEX"))) {
  console.error("FAIL: SEDEX must remain above threshold");
  process.exit(1);
}

console.log("threshold filter: PDF excluded, SEDEX kept (ideal)");
console.log("OK: EVENT: ALIGN_VECTOR_COMPLETE verification passed");
console.log(`workdir=${path.resolve(__dirname, "..")}`);
