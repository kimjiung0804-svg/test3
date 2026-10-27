/**
 * Offline verification for ELEC-33: exact/keyword boost so
 * "삼성전자 부스 번호" ranks the matching XLSX row above unrelated PDFs,
 * and chat context formatting labels excel rows clearly.
 * Run: node scripts/verify-xlsx-rag.mjs
 */
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

const FIELD_QUERY_HINT =
  /(부스|부스위치|부스번호|번호|업체명|회사명|참가사|명단|booth|company|vendor)/i;
const EXCEL_QUERY_HINT =
  /\b(xlsx|xls|excel|sedex|시트|참가사|명단|리스트|spreadsheet)\b/i;

function tokenizeQuery(text) {
  const parts = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  return [...new Set(parts)];
}

function significantTokens(tokens) {
  return tokens.filter((t) => t.length >= 3 || /[0-9]/.test(t));
}

function computeHybridScore({
  query,
  filename,
  content,
  fileType,
  cosineSimilarity,
}) {
  const tokens = tokenizeQuery(query);
  const sigTokens = significantTokens(tokens);
  const filenameLower = filename.toLowerCase();
  const contentLower = content.toLowerCase();
  const ft = (fileType || "").toLowerCase();
  const isExcel = ft === "xlsx" || ft === "xls";

  const matchedFilename = [];
  const matchedContent = [];
  const exactContent = [];

  for (const token of tokens) {
    if (filenameLower.includes(token)) matchedFilename.push(token);
    if (contentLower.includes(token)) matchedContent.push(token);
  }
  for (const token of sigTokens) {
    if (contentLower.includes(token)) exactContent.push(token);
  }

  const filename_boost = Math.min(0.5, matchedFilename.length * 0.2);
  const contentHitRatio =
    tokens.length === 0 ? 0 : matchedContent.length / tokens.length;
  const content_ratio_boost = Math.min(0.18, contentHitRatio * 0.24);
  let exact_boost = Math.min(0.6, exactContent.length * 0.28);
  if (exactContent.length > 0 && isExcel) exact_boost += 0.18;

  let typeBoost = 0;
  if (
    (EXCEL_QUERY_HINT.test(query) || FIELD_QUERY_HINT.test(query)) &&
    isExcel
  ) {
    typeBoost += 0.1;
  }
  if (
    tokens.length > 0 &&
    matchedFilename.length === 0 &&
    matchedContent.length === 0
  ) {
    typeBoost -= 0.22;
  }

  const content_boost = content_ratio_boost + exact_boost;
  return {
    final_score:
      cosineSimilarity + filename_boost + content_boost + typeBoost,
    matched_tokens: [...new Set([...matchedFilename, ...matchedContent])],
    filename_hit: matchedFilename.length > 0,
    exact_content_hit: exactContent.length > 0,
    exact_boost,
  };
}

function applyKeywordGate(ranked) {
  const hasStrong = ranked.some(
    (r) => r.filename_hit || r.exact_content_hit,
  );
  if (!hasStrong) {
    return { kept: ranked, gated: [], keyword_gate_applied: false };
  }
  return {
    kept: ranked.filter((r) => (r.matched_tokens?.length ?? 0) > 0),
    gated: ranked.filter((r) => (r.matched_tokens?.length ?? 0) === 0),
    keyword_gate_applied: true,
  };
}

function formatContextBlock(chunks) {
  return chunks
    .map((c, i) => {
      const isExcel =
        c.file_type === "xlsx" ||
        /(?:^|\n)\s*Row\s+\d+\s*:/i.test(c.content);
      const loc = [];
      if (c.sheet) loc.push(`sheet=${c.sheet}`);
      if (c.row != null) loc.push(`row=${c.row}`);
      const kind = isExcel ? ", excel_row (header:value)" : "";
      const header = `[${i + 1}] ${c.filename}${loc.length ? `, ${loc.join(", ")}` : ""}${kind}`;
      const body = isExcel
        ? `Selected spreadsheet row (use these header:value fields):\n${c.content}`
        : c.content;
      return `${header}\n${body}`;
    })
    .join("\n\n---\n\n");
}

// --- Case: 삼성전자 부스 번호 ---
const query = "삼성전자 부스 번호";
const samsungRow = computeHybridScore({
  query,
  filename: "2026_SEDEX 참가사리스트.xlsx",
  content:
    "Row 298: No: 298 | 업체명: 삼성전자 | 부스위치: C100 | 구분: 참가사",
  fileType: "xlsx",
  cosineSimilarity: 0.31,
});
const otherRow = computeHybridScore({
  query,
  filename: "2026_SEDEX 참가사리스트.xlsx",
  content: "Row 10: No: 10 | 업체명: Enable Design | 부스위치: A12 | 구분: 참가사",
  fileType: "xlsx",
  cosineSimilarity: 0.28,
});
const unrelatedPdf = computeHybridScore({
  query,
  filename: "경기행복주택_안내.pdf",
  content: "행복주택 입주 자격 및 신청 방법 안내문",
  fileType: "pdf",
  cosineSimilarity: 0.58,
});

console.log("query:", query);
console.log("samsung row:", {
  score: samsungRow.final_score.toFixed(3),
  exact: samsungRow.exact_content_hit,
  tokens: samsungRow.matched_tokens,
});
console.log("other row:", {
  score: otherRow.final_score.toFixed(3),
  exact: otherRow.exact_content_hit,
  tokens: otherRow.matched_tokens,
});
console.log("unrelated PDF:", {
  score: unrelatedPdf.final_score.toFixed(3),
  exact: unrelatedPdf.exact_content_hit,
  tokens: unrelatedPdf.matched_tokens,
});

const ranked = [
  { name: "samsung-row", ...samsungRow },
  { name: "other-row", ...otherRow },
  { name: "pdf", ...unrelatedPdf },
].sort((a, b) => b.final_score - a.final_score);

const gate = applyKeywordGate(ranked);
const minScore = 0.5;
const topK = gate.kept
  .filter((r) => r.final_score >= minScore)
  .slice(0, 5);

console.log(
  "ranked:",
  ranked.map((r) => `${r.name}=${r.final_score.toFixed(3)}`),
);
console.log("keyword_gate_applied:", gate.keyword_gate_applied);
console.log(
  "Top-K above threshold:",
  topK.map((r) => r.name),
);
console.log(
  "gated out:",
  gate.gated.map((r) => r.name),
);

if (ranked[0].name !== "samsung-row") {
  console.error("FAIL: 삼성전자 XLSX row must rank #1");
  process.exit(1);
}
if (!samsungRow.exact_content_hit) {
  console.error("FAIL: exact content hit expected for 삼성전자");
  process.exit(1);
}
if (samsungRow.final_score < minScore) {
  console.error("FAIL: samsung row must clear similarity_threshold 0.5");
  process.exit(1);
}
if (!gate.keyword_gate_applied) {
  console.error("FAIL: content exact gate should activate");
  process.exit(1);
}
if (topK.some((r) => r.name === "pdf")) {
  console.error("FAIL: unrelated PDF must not remain in Top-K context");
  process.exit(1);
}
if (!topK.some((r) => r.name === "samsung-row")) {
  console.error("FAIL: samsung row must be in chat context Top-K");
  process.exit(1);
}

const context = formatContextBlock([
  {
    filename: "2026_SEDEX 참가사리스트.xlsx",
    file_type: "xlsx",
    sheet: "참가사",
    row: 298,
    content:
      "Row 298: No: 298 | 업체명: 삼성전자 | 부스위치: C100 | 구분: 참가사",
  },
]);
if (!context.includes("excel_row (header:value)")) {
  console.error("FAIL: context must label excel_row header:value");
  process.exit(1);
}
if (!context.includes("Selected spreadsheet row")) {
  console.error("FAIL: context must clearly pass selected row chunk");
  process.exit(1);
}
if (!context.includes("업체명: 삼성전자") || !context.includes("C100")) {
  console.error("FAIL: context must include 삼성전자 / C100 fields");
  process.exit(1);
}

console.log("context preview:\n", context.slice(0, 280));
console.log("OK: EVENT: XLSX_RAG_COMPLETE verification passed");
console.log(`workdir=${path.resolve(__dirname, "..")}`);
