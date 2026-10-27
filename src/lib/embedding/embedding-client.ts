/**
 * Embedding client: prefer LOCAL_EMBEDDING_URL when set; otherwise a
 * deterministic local hash embedding so indexing works fully offline.
 */

const LOCAL_FALLBACK_DIMS = 384;
const LOCAL_FALLBACK_MODEL = "local-hash-v1";

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  source: "remote" | "local_fallback";
}

function getEmbeddingBaseUrl(): string | null {
  const url =
    process.env.LOCAL_EMBEDDING_URL?.trim() ||
    process.env.EMBEDDING_BASE_URL?.trim() ||
    "";
  return url || null;
}

/** Cosine similarity between two equal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Deterministic bag-of-tokens hashing into a fixed unit vector. */
export function localHashEmbedding(
  text: string,
  dims = LOCAL_FALLBACK_DIMS,
): number[] {
  const vec = new Float64Array(dims);
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);

  if (tokens.length === 0) {
    // Tiny non-zero so similarity math stays defined
    vec[0] = 1;
    return Array.from(vec);
  }

  for (const token of tokens) {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dims;
    const sign = (h & 1) === 0 ? 1 : -1;
    vec[idx]! += sign;
    // Character bigrams for short-query robustness
    if (token.length >= 2) {
      for (let i = 0; i < token.length - 1; i++) {
        const bi = token.slice(i, i + 2);
        let h2 = 2166136261;
        for (let j = 0; j < bi.length; j++) {
          h2 ^= bi.charCodeAt(j);
          h2 = Math.imul(h2, 16777619);
        }
        const idx2 = Math.abs(h2) % dims;
        vec[idx2]! += (h2 & 1) === 0 ? 0.5 : -0.5;
      }
    }
  }

  let norm = 0;
  for (let i = 0; i < dims; i++) norm += vec[i]! * vec[i]!;
  norm = Math.sqrt(norm) || 1;
  const out = new Array<number>(dims);
  for (let i = 0; i < dims; i++) out[i] = vec[i]! / norm;
  return out;
}

async function embedViaRemote(
  baseUrl: string,
  texts: string[],
): Promise<{ embeddings: number[][]; model: string } | null> {
  const endpoints = buildCandidateEndpoints(baseUrl);

  for (const endpoint of endpoints) {
    // OpenAI-compatible
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: texts.length === 1 ? texts[0] : texts,
          model: process.env.LOCAL_EMBEDDING_MODEL?.trim() || "nomic-embed-text",
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          data?: Array<{ embedding: number[] }>;
          embeddings?: number[][];
          model?: string;
        };
        if (Array.isArray(data.data) && data.data[0]?.embedding) {
          return {
            embeddings: data.data.map((d) => d.embedding),
            model: data.model || "remote-openai-compat",
          };
        }
        if (Array.isArray(data.embeddings) && data.embeddings[0]) {
          return {
            embeddings: data.embeddings,
            model: data.model || "remote-embeddings",
          };
        }
      }
    } catch {
      /* try next shape */
    }

    // Simple { texts: string[] } / { text: string }
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          texts.length === 1 ? { text: texts[0] } : { texts },
        ),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          embedding?: number[];
          embeddings?: number[][];
          model?: string;
        };
        if (Array.isArray(data.embedding)) {
          return {
            embeddings: [data.embedding],
            model: data.model || "remote-simple",
          };
        }
        if (Array.isArray(data.embeddings) && data.embeddings[0]) {
          return {
            embeddings: data.embeddings,
            model: data.model || "remote-simple",
          };
        }
      }
    } catch {
      /* try next endpoint */
    }
  }

  return null;
}

function buildCandidateEndpoints(baseUrl: string): string[] {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const out = [trimmed];
  if (!/\/embeddings$/i.test(trimmed) && !/\/embed$/i.test(trimmed)) {
    out.push(`${trimmed}/embeddings`);
    out.push(`${trimmed}/embed`);
    out.push(`${trimmed}/v1/embeddings`);
  }
  return out;
}

export async function embedTexts(texts: string[]): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return [];

  const baseUrl = getEmbeddingBaseUrl();
  if (baseUrl) {
    const remote = await embedViaRemote(baseUrl, texts);
    if (remote && remote.embeddings.length === texts.length) {
      return remote.embeddings.map((embedding) => ({
        embedding,
        model: remote.model,
        source: "remote" as const,
      }));
    }
  }

  return texts.map((t) => ({
    embedding: localHashEmbedding(t),
    model: LOCAL_FALLBACK_MODEL,
    source: "local_fallback" as const,
  }));
}

export async function embedText(text: string): Promise<EmbeddingResult> {
  const [first] = await embedTexts([text]);
  return (
    first ?? {
      embedding: localHashEmbedding(text),
      model: LOCAL_FALLBACK_MODEL,
      source: "local_fallback",
    }
  );
}
