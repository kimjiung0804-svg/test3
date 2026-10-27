/**
 * Hybrid retrieval helpers: keyword / filename boosting + threshold filtering.
 * Used by similarity search to reduce false positives and apply minScore.
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

/** Tokenize query/content for keyword overlap (letters + numbers, incl. CJK runs). */
export function tokenizeQuery(text: string): string[] {
  const lower = text.toLowerCase();
  const parts = lower
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
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
  final_score: number;
  cosine_similarity: number;
  filename_boost: number;
  content_boost: number;
  matched_tokens: string[];
}

const FILENAME_BOOST_PER_HIT = 0.18;
const FILENAME_BOOST_CAP = 0.45;
const CONTENT_BOOST_CAP = 0.2;
const EXCEL_QUERY_HINT =
  /\b(xlsx|xls|excel|시트|참가사|명단|리스트|spreadsheet)\b/i;

/**
 * Combine cosine similarity with filename/content keyword boosts.
 * Unrelated docs without query tokens stay near raw cosine (or get demoted).
 */
export function computeHybridScore(input: HybridBoostInput): HybridBoostResult {
  const tokens = tokenizeQuery(input.query);
  const filenameLower = input.filename.toLowerCase();
  const contentLower = input.content.toLowerCase();

  const matchedFilename: string[] = [];
  const matchedContent: string[] = [];

  for (const token of tokens) {
    if (filenameLower.includes(token)) matchedFilename.push(token);
    else if (contentLower.includes(token)) matchedContent.push(token);
  }

  const filename_boost = Math.min(
    FILENAME_BOOST_CAP,
    matchedFilename.length * FILENAME_BOOST_PER_HIT,
  );

  const contentHitRatio =
    tokens.length === 0 ? 0 : matchedContent.length / tokens.length;
  let content_boost = Math.min(CONTENT_BOOST_CAP, contentHitRatio * 0.25);

  let typeBoost = 0;
  const ft = (input.fileType ?? "").toLowerCase();
  if (EXCEL_QUERY_HINT.test(input.query) && (ft === "xlsx" || ft === "xls")) {
    typeBoost = 0.08;
  }

  // Soft demotion when the query has tokens but none appear in filename/content.
  if (
    tokens.length > 0 &&
    matchedFilename.length === 0 &&
    matchedContent.length === 0
  ) {
    typeBoost -= 0.12;
  }

  const matched_tokens = [...new Set([...matchedFilename, ...matchedContent])];
  const final_score =
    input.cosineSimilarity + filename_boost + content_boost + typeBoost;

  return {
    final_score,
    cosine_similarity: input.cosineSimilarity,
    filename_boost: filename_boost + typeBoost,
    content_boost,
    matched_tokens,
  };
}

/** Clamp / sanitize a client-provided min score (default 0.5 per RAG settings). */
export function resolveMinScore(raw?: number, fallback = 0.5): number {
  if (raw == null || !Number.isFinite(raw)) return fallback;
  return Math.max(0, Math.min(1, raw));
}
