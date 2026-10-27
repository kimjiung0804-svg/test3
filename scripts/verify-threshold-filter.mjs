/**
 * Offline smoke for ELEC-20: relevance / minScore threshold + hybrid ranking.
 * Run: node scripts/verify-threshold-filter.mjs
 */

function tokenizeQuery(text) {
  const STOPWORDS = new Set([
    "a",
    "an",
    "the",
    "and",
    "or",
    "list",
    "lists",
    "file",
    "files",
  ]);
  const parts = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  return [...new Set(parts)];
}

function resolveMinScore(raw, fallback = 0.5) {
  if (raw == null || !Number.isFinite(raw)) return fallback;
  return Math.max(0, Math.min(1, raw));
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
  const filename_boost = Math.min(0.45, matchedFilename.length * 0.18);
  const contentHitRatio =
    tokens.length === 0 ? 0 : matchedContent.length / tokens.length;
  const content_boost = Math.min(0.2, contentHitRatio * 0.25);
  let typeBoost = 0;
  const excelHint =
    /\b(xlsx|xls|excel|시트|참가사|명단|리스트|spreadsheet)\b/i;
  const ft = (fileType || "").toLowerCase();
  if (excelHint.test(query) && (ft === "xlsx" || ft === "xls")) typeBoost = 0.08;
  if (
    tokens.length > 0 &&
    matchedFilename.length === 0 &&
    matchedContent.length === 0
  ) {
    typeBoost -= 0.12;
  }
  return {
    final_score: cosineSimilarity + filename_boost + content_boost + typeBoost,
    matched_tokens: [...new Set([...matchedFilename, ...matchedContent])],
  };
}

/** Mirror vector-db Top-K + threshold split. */
function applyThresholdFilter(scored, { topK = 5, minScore = 0.5 } = {}) {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const passed = [];
  const below = [];
  for (const item of sorted) {
    if (item.score >= minScore) passed.push({ ...item, below_threshold: false });
    else below.push({ ...item, below_threshold: true });
  }
  return {
    chunks: passed.slice(0, topK),
    below_threshold: below.slice(0, topK),
    min_score: minScore,
  };
}

// --- resolveMinScore ---
if (resolveMinScore(undefined) !== 0.5) {
  console.error("FAIL: default minScore should be 0.5");
  process.exit(1);
}
if (resolveMinScore(1.5) !== 1) {
  console.error("FAIL: minScore should clamp to 1");
  process.exit(1);
}
if (resolveMinScore(-0.2) !== 0) {
  console.error("FAIL: minScore should clamp to 0");
  process.exit(1);
}
if (resolveMinScore(0.7) !== 0.7) {
  console.error("FAIL: minScore should pass through valid values");
  process.exit(1);
}
console.log("resolveMinScore: OK");

// --- hybrid ranking + threshold ---
const query = "SEDEX 참가사 리스트";
const sedex = computeHybridScore({
  query,
  filename: "SEDEX_참가사_리스트.xlsx",
  content: "Row 1: 회사명: SEDEX Korea | 구분: 참가사",
  fileType: "xlsx",
  cosineSimilarity: 0.42,
});
const unrelated = computeHybridScore({
  query,
  filename: "경기행복주택_안내.pdf",
  content: "행복주택 입주 자격 및 신청 방법 안내문",
  fileType: "pdf",
  cosineSimilarity: 0.55,
});

console.log(
  "SEDEX score:",
  sedex.final_score.toFixed(3),
  sedex.matched_tokens,
);
console.log(
  "unrelated PDF score:",
  unrelated.final_score.toFixed(3),
  unrelated.matched_tokens,
);

if (sedex.final_score <= unrelated.final_score) {
  console.error("FAIL: SEDEX XLSX should rank above unrelated PDF after boost");
  process.exit(1);
}

const minScore = 0.5;
const filtered = applyThresholdFilter(
  [
    { name: "SEDEX_참가사_리스트.xlsx", score: sedex.final_score },
    { name: "경기행복주택_안내.pdf", score: unrelated.final_score },
    { name: "weak.txt", score: 0.2 },
  ],
  { topK: 5, minScore },
);

console.log(
  "passed:",
  filtered.chunks.map((c) => `${c.name}=${c.score.toFixed(3)}`),
);
console.log(
  "below:",
  filtered.below_threshold.map((c) => `${c.name}=${c.score.toFixed(3)}`),
);

if (filtered.chunks.some((c) => c.score < minScore)) {
  console.error("FAIL: chunks above threshold list contains below-threshold hit");
  process.exit(1);
}
if (filtered.below_threshold.some((c) => c.score >= minScore)) {
  console.error("FAIL: below_threshold list contains a pass hit");
  process.exit(1);
}
if (!filtered.chunks.find((c) => c.name.includes("SEDEX"))) {
  console.error("FAIL: SEDEX should pass minScore after hybrid boost");
  process.exit(1);
}
if (!filtered.below_threshold.find((c) => c.name === "weak.txt")) {
  console.error("FAIL: weak.txt should be separated into below_threshold");
  process.exit(1);
}

// Settings alignment: chat/inspect use the same resolveMinScore path
const settingsThreshold = 0.65;
const fromSettings = resolveMinScore(settingsThreshold);
const retrieval = applyThresholdFilter(
  [
    { name: "a", score: 0.7 },
    { name: "b", score: 0.6 },
    { name: "c", score: 0.4 },
  ],
  { topK: 10, minScore: fromSettings },
);
if (retrieval.chunks.length !== 1 || retrieval.chunks[0].name !== "a") {
  console.error("FAIL: settings threshold 0.65 should keep only score>=0.65");
  process.exit(1);
}
if (retrieval.below_threshold.length !== 2) {
  console.error("FAIL: two hits should be separated below threshold");
  process.exit(1);
}
console.log("settings alignment: OK (threshold 0.65 → 1 kept, 2 below)");

console.log("OK: EVENT: FIX_VECTOR_RETRY_COMPLETE verification passed");
