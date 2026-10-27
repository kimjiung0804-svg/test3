/**
 * Hybrid retrieval helpers: keyword / exact / filename boosting + threshold filtering.
 * Lifts XLSX row chunks for entity queries (e.g. "삼성전자 부스 번호") and demotes
 * unrelated PDFs that only matched on weak embedding cosine.
 */

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "is",
  "are",
  "was",
  "were",
  "be",
  "with",
  "by",
  "from",
  "at",
  "as",
  "it",
  "this",
  "that",
  "list",
  "lists",
  "file",
  "files",
  "document",
  "documents",
  "what",
  "which",
  "who",
  "how",
  "when",
  "where",
  "왜",
  "무엇",
  "어디",
  "언제",
  "어떤",
  "있는",
  "없는",
  "대해",
  "대한",
  "관련",
  "알려",
  "주세요",
  "보여",
  "줘",
]);

/** Field / booth style tokens — soft affinity toward spreadsheet rows. */
const FIELD_QUERY_HINT =
  /(부스|부스위치|부스번호|번호|업체명|회사명|참가사|명단|booth|company|vendor)/i;

const EXCEL_QUERY_HINT =
  /\b(xlsx|xls|excel|sedex|시트|참가사|명단|리스트|spreadsheet)\b/i;

/** Tokenize query/content for keyword overlap (letters + numbers, incl. CJK runs). */
export function tokenizeQuery(text: string): string[] {
  const lower = text.toLowerCase();
  const parts = lower
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  // Deduplicate while preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * Significant tokens for exact boosting — longer entity-like tokens get priority
 * (company names, codes). Short field words still count but weigh less.
 */
export function significantTokens(tokens: string[]): string[] {
  return tokens.filter((t) => {
    if (t.length >= 3) return true;
    // Alphanumeric booth codes like C100 / A12
    return /[0-9]/.test(t);
  });
}

export interface HybridBoostInput {
  query: string;
  filename: string;
  content: string;
  fileType?: string;
  /** Raw cosine similarity in [-1, 1] (typically [0, 1] for unit vectors). */
  cosineSimilarity: number;
}

export interface HybridBoostResult {
  /** Cosine + boosts, usable for ranking against similarity_threshold. */
  final_score: number;
  cosine_similarity: number;
  filename_boost: number;
  content_boost: number;
  exact_boost: number;
  matched_tokens: string[];
  /** True when at least one query token appears in the filename. */
  filename_hit: boolean;
  /** True when a significant query token appears exactly in chunk content. */
  exact_content_hit: boolean;
}

const FILENAME_BOOST_PER_HIT = 0.2;
const FILENAME_BOOST_CAP = 0.5;
const CONTENT_RATIO_CAP = 0.18;
/** Per-token exact substring hit in content (entity / company name). */
const EXACT_BOOST_PER_HIT = 0.28;
const EXACT_BOOST_CAP = 0.6;
/** Extra lift when an exact hit lands in an XLSX/XLS row chunk. */
const EXCEL_EXACT_BONUS = 0.18;
/** Demotion for zero keyword overlap — pulls pure-embedding false positives under 0.5. */
const ZERO_MATCH_DEMOTION = 0.22;

/**
 * Combine cosine similarity with filename / content keyword and exact boosts.
 * Unrelated PDFs without query tokens stay near (or below) raw cosine;
 * XLSX rows containing the queried company name get a clear ranking lift.
 */
export function computeHybridScore(input: HybridBoostInput): HybridBoostResult {
  const tokens = tokenizeQuery(input.query);
  const sigTokens = significantTokens(tokens);
  const filenameLower = input.filename.toLowerCase();
  const contentLower = input.content.toLowerCase();
  const ft = (input.fileType ?? "").toLowerCase();
  const isExcel = ft === "xlsx" || ft === "xls";

  const matchedFilename: string[] = [];
  const matchedContent: string[] = [];
  const exactContent: string[] = [];

  for (const token of tokens) {
    const inFile = filenameLower.includes(token);
    const inContent = contentLower.includes(token);
    if (inFile) matchedFilename.push(token);
    if (inContent) matchedContent.push(token);
  }

  for (const token of sigTokens) {
    if (contentLower.includes(token)) exactContent.push(token);
  }

  const filename_boost = Math.min(
    FILENAME_BOOST_CAP,
    matchedFilename.length * FILENAME_BOOST_PER_HIT,
  );

  // Soft content overlap (fraction of query tokens present)
  const contentHitRatio =
    tokens.length === 0 ? 0 : matchedContent.length / tokens.length;
  const content_ratio_boost = Math.min(
    CONTENT_RATIO_CAP,
    contentHitRatio * 0.24,
  );

  // Strong exact boost: each significant token found verbatim in the chunk
  let exact_boost = Math.min(
    EXACT_BOOST_CAP,
    exactContent.length * EXACT_BOOST_PER_HIT,
  );
  if (exactContent.length > 0 && isExcel) {
    exact_boost += EXCEL_EXACT_BONUS;
  }

  let typeBoost = 0;
  if (
    (EXCEL_QUERY_HINT.test(input.query) || FIELD_QUERY_HINT.test(input.query)) &&
    isExcel
  ) {
    typeBoost += 0.1;
  }

  // Soft demotion when the query has tokens but none appear in filename/content.
  if (
    tokens.length > 0 &&
    matchedFilename.length === 0 &&
    matchedContent.length === 0
  ) {
    typeBoost -= ZERO_MATCH_DEMOTION;
  }

  const content_boost = content_ratio_boost + exact_boost;
  const matched_tokens = [
    ...new Set([...matchedFilename, ...matchedContent]),
  ];
  const final_score =
    input.cosineSimilarity +
    filename_boost +
    content_boost +
    typeBoost;

  return {
    final_score,
    cosine_similarity: input.cosineSimilarity,
    filename_boost: filename_boost + typeBoost,
    content_boost,
    exact_boost,
    matched_tokens,
    filename_hit: matchedFilename.length > 0,
    exact_content_hit: exactContent.length > 0,
  };
}

/** Clamp / sanitize a client-provided min score (default 0.5 per RAG settings). */
export function resolveMinScore(raw?: number, fallback = 0.5): number {
  if (raw == null || !Number.isFinite(raw)) return fallback;
  return Math.max(0, Math.min(1, raw));
}
