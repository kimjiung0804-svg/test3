# Local Document RAG (`test3`)

Local-only PDF / DOCX / XLSX upload, text extraction, chunking, and vector inspection.

## Getting Started

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## XLSX extraction & re-indexing

Excel files are parsed into sheet-scoped **header:value** rows (not raw CSV), so list-style workbooks (e.g. SEDEX participant sheets) embed with searchable field labels.

Preview extracted text:

```bash
curl -s "http://localhost:3000/api/files/<file_id>/preview" | jq '.text_length, .text[:400]'
```

After a parser fix, re-extract and re-index an already-uploaded file (keeps the same `file_id`):

```bash
curl -s -X POST "http://localhost:3000/api/files/<file_id>/reparse" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Optional body: `{ "chunk_size": 500, "chunk_overlap": 50 }`.

Empty extracts are rejected on upload/reparse with `empty_extract` and logged as `[extract]` / `[reparse]`.
