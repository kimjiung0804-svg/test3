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

Excel sheets are scanned for a header row (labels such as `No`, `업체명`, `부스위치`), then each data row is emitted as a self-contained **header:value** line (not raw CSV). Example:

```text
# Sheet: 참가사리스트
# Headers (Excel row 1): No | 업체명 | 부스위치
[Sheet: 참가사리스트] Row 298 | No: 298 | 업체명: 삼성전자 | 부스위치: C100
```

Preview (includes structured `rows` for row-level inspection; optional `?q=` filter):

```bash
curl -s "http://localhost:3000/api/files/<file_id>/preview?q=삼성전자" \
  | jq '{text_length, row_count, rows: .rows[:3]}'
```

After a parser fix, re-extract and re-index an already-uploaded file (keeps the same `file_id`):

```bash
curl -s -X POST "http://localhost:3000/api/files/<file_id>/reparse" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Optional body: `{ "chunk_size": 500, "chunk_overlap": 50 }`.

Alternatively delete + re-upload via `DELETE /api/files?file_id=...` then `POST /api/upload`.

Empty extracts are rejected on upload/reparse with `empty_extract` and logged as `[extract]` / `[reparse]`.
