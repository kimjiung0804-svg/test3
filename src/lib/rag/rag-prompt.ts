import type { CitationData, VectorInspectChunk } from "@/lib/types";

const SYSTEM_INSTRUCTION = `You are a helpful assistant for a local document Q&A system.
Answer ONLY using the provided context chunks from uploaded documents.
If the context is insufficient, say you do not have enough information in the documents.
Cite sources inline using [n] where n is the chunk number from the context.
Keep answers concise and factual. Do not invent facts outside the context.`;

const LOW_CONFIDENCE_INSTRUCTION = `You are a helpful assistant for a local document Q&A system.
No document chunks met the relevance threshold for this question (low-confidence retrieval).
Do NOT invent document contents. Clearly tell the user that the indexed documents do not
appear relevant enough to answer confidently, and suggest rephrasing or uploading related files.`;

/** Build CitationData list from retrieved vector chunks. */
export function chunksToCitations(
  chunks: VectorInspectChunk[],
): CitationData[] {
  return chunks.map((c) => ({
    chunk_id: c.chunk_id,
    file_id: c.file_id,
    filename: c.metadata.filename,
    similarity_score: c.similarity_score ?? 0,
    page_number: c.page_number ?? c.metadata.page_number,
    sheet: c.sheet_name ?? c.metadata.sheet ?? null,
    row: c.row_number ?? c.metadata.row ?? null,
    content_preview: (c.content || c.metadata.content_preview || "").slice(
      0,
      200,
    ),
    sequence_number: c.sequence_number ?? c.metadata.chunk_sequence,
  }));
}

/** Format retrieved chunks into a numbered context block for the LLM. */
export function formatContextBlock(chunks: VectorInspectChunk[]): string {
  if (chunks.length === 0) {
    return "(No relevant document chunks were retrieved.)";
  }

  return chunks
    .map((c, i) => {
      const n = i + 1;
      const sheet = c.sheet_name ?? c.metadata.sheet;
      const row = c.row_number ?? c.metadata.row;
      const locParts: string[] = [];
      if (sheet) locParts.push(`sheet ${sheet}`);
      if (row != null) locParts.push(`row ${row}`);
      else if (c.page_number != null) locParts.push(`page ${c.page_number}`);
      const loc = locParts.length > 0 ? `, ${locParts.join(", ")}` : "";
      const score =
        c.similarity_score != null
          ? `, score=${c.similarity_score.toFixed(4)}`
          : "";
      const header = `[${n}] ${c.metadata.filename}${loc}${score} (chunk_id=${c.chunk_id})`;
      return `${header}\n${c.content}`;
    })
    .join("\n\n---\n\n");
}

/** Assemble OpenAI-style messages for a RAG turn. */
export function buildRagMessages(params: {
  userMessage: string;
  chunks: VectorInspectChunk[];
  /** When true, instruct the model that retrieval was below threshold. */
  lowConfidence?: boolean;
}): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const lowConfidence =
    Boolean(params.lowConfidence) || params.chunks.length === 0;
  const context = formatContextBlock(params.chunks);
  return [
    {
      role: "system",
      content: lowConfidence ? LOW_CONFIDENCE_INSTRUCTION : SYSTEM_INSTRUCTION,
    },
    {
      role: "user",
      content: lowConfidence
        ? `Retrieved context (empty / below threshold):\n\n${context}\n\nUser question:\n${params.userMessage}`
        : `Context from documents:\n\n${context}\n\nUser question:\n${params.userMessage}`,
    },
  ];
}
