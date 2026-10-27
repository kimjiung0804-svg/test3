/**
 * Smoke-verify row-aware XLSX chunking against the current extract format.
 * Run: node --experimental-strip-types scripts/verify-xlsx-row-chunk.mjs
 */
import { mkdir, writeFile, rm } from "fs/promises";
import path from "path";
import { randomUUID, createHash } from "crypto";
import { pathToFileURL } from "url";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const tmpRoot = path.join(root, "storage", ".verify-xlsx-row");
const vectorDbPath = path.join(tmpRoot, "vectordb");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Matches src/lib/extract.ts header_row_pairs output. */
function buildSedexLikeExtract(rowCount = 310) {
  const headers = "No | 업체명 | 부스위치 | 국가";
  const parts = [
    "# Sheet: 참가사리스트",
    `# Headers (Excel row 1): ${headers}`,
  ];
  for (let r = 2; r <= rowCount + 1; r++) {
    const dataNo = r - 1;
    let company = `업체_${dataNo}`;
    let booth = `A${String(dataNo).padStart(3, "0")}`;
    // Excel row 298 → 삼성전자 / C100 (as in the reported bug)
    if (r === 298) {
      company = "삼성전자";
      booth = "C100";
    }
    parts.push(
      `[Sheet: 참가사리스트] Row ${r} | No: ${dataNo} | 업체명: ${company} | 부스위치: ${booth} | 국가: KR`,
    );
  }
  return parts.join("\n\n");
}

function hashEmbed(text, dims = 32) {
  const vec = new Float64Array(dims);
  const tokens = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const token of tokens) {
    const h = createHash("sha256").update(token).digest();
    const idx = h.readUInt32BE(0) % dims;
    vec[idx] += 1;
  }
  let norm = 0;
  for (let i = 0; i < dims; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (v) => v / norm);
}

async function main() {
  await rm(tmpRoot, { recursive: true, force: true });
  await mkdir(path.join(vectorDbPath, "files"), { recursive: true });

  const { chunkText, isXlsxRowExtract } = await import(
    pathToFileURL(path.join(root, "src/lib/chunking/text-chunker.ts")).href
  );

  const text = buildSedexLikeExtract(310);
  assert(isXlsxRowExtract(text), "expected XLSX row extract detection");

  const slices = chunkText(text, { chunkSize: 800, chunkOverlap: 50 });
  assert(slices.length > 0, "no chunks produced");
  assert(
    slices.every((s) => s.chunk_strategy === "xlsx_row"),
    "expected all chunks to use xlsx_row strategy",
  );
  assert(
    slices.every((s) => s.content.includes("# Sheet:")),
    "each chunk must carry sheet header context",
  );
  assert(
    slices.every((s) => s.content.includes("Headers:")),
    "each chunk must carry Headers context",
  );

  for (const s of slices) {
    for (const line of s.content
      .split("\n")
      .filter((l) => /\[Sheet:/.test(l) && /Row\s+\d+/.test(l))) {
      assert(
        /업체명:/.test(line) && /부스위치:/.test(line),
        `broken row line in seq=${s.sequence_number}: ${line.slice(0, 80)}`,
      );
    }
  }

  const samsung = slices.filter(
    (s) =>
      (s.company_name && s.company_name.includes("삼성전자")) ||
      s.content.includes("삼성전자"),
  );
  assert(samsung.length >= 1, "삼성전자 row chunk missing");
  const hit = samsung.find((s) => s.content.includes("C100"));
  assert(hit, "C100 booth missing from 삼성전자 chunk");
  assert(hit.row_number === 298, `expected row_number 298, got ${hit.row_number}`);
  assert(hit.sheet_name === "참가사리스트", `sheet=${hit.sheet_name}`);
  assert(hit.company_name === "삼성전자", `company_name=${hit.company_name}`);

  const fileId = randomUUID();
  const filename = "2026_SEDEX 참가사리스트.xlsx";
  const now = new Date().toISOString();
  const chunks = [];
  const vectors = [];
  for (const slice of slices) {
    const chunkId = randomUUID();
    const vectorId = randomUUID();
    chunks.push({
      id: chunkId,
      file_id: fileId,
      content: slice.content,
      sequence_number: slice.sequence_number,
      start_char: slice.start_char,
      end_char: slice.end_char,
      page_number: slice.page_number,
      sheet_name: slice.sheet_name,
      row_number: slice.row_number,
      company_name: slice.company_name,
      created_at: now,
    });
    vectors.push({
      id: vectorId,
      chunk_id: chunkId,
      file_id: fileId,
      embedding: hashEmbed(slice.content),
      embedding_model: "local-hash-v1",
      metadata: {
        filename,
        chunk_sequence: slice.sequence_number,
        page_number: slice.page_number,
        sheet: slice.sheet_name,
        row: slice.row_number,
        company_name: slice.company_name,
        file_type: "xlsx",
        content_preview: slice.content.slice(0, 160),
      },
      indexed_at: now,
    });
  }

  const store = {
    file_id: fileId,
    filename,
    file_type: "xlsx",
    chunks,
    vectors,
    updated_at: now,
  };
  await writeFile(
    path.join(vectorDbPath, "files", `${fileId}.json`),
    JSON.stringify(store, null, 2),
    "utf-8",
  );
  await writeFile(
    path.join(vectorDbPath, "catalog.json"),
    JSON.stringify(
      {
        version: 1,
        files: [
          {
            file_id: fileId,
            filename,
            chunks_count: chunks.length,
            indexed_at: now,
          },
        ],
      },
      null,
      2,
    ),
    "utf-8",
  );

  const needles = ["삼성전자", "c100"];
  const hits = chunks.filter((c) => {
    const hay = [
      c.content,
      c.sheet_name ?? "",
      c.company_name ?? "",
      String(c.row_number ?? ""),
    ]
      .join("\n")
      .toLowerCase();
    return needles.every((n) => hay.includes(n));
  });
  assert(hits.length >= 1, "contains filter 삼성전자 C100 found 0");
  assert(hits[0].row_number === 298, "inspect hit row mismatch");

  const report = {
    ok: true,
    chunks_created: chunks.length,
    samsung_chunks: samsung.length,
    inspect_hits: hits.length,
    sample: {
      row_number: hit.row_number,
      sheet_name: hit.sheet_name,
      company_name: hit.company_name,
      preview: hit.content.slice(0, 260),
    },
    vectordb_file: `files/${fileId}.json`,
  };

  await writeFile(
    path.join(tmpRoot, "verify-report.json"),
    JSON.stringify(report, null, 2),
    "utf-8",
  );
  console.log(JSON.stringify(report, null, 2));
  console.log("EVENT: XLSX_VECTOR_COMPLETE");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
