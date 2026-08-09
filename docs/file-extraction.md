# Files that become data

Uploading a contract to RunButter is not filing it. The text is extracted, indexed with
Postgres full-text search, and stored **in the same database as the ledger** — so
"which of our contracts auto-renew, for clients who already owe us money" is one
query rather than a morning of opening PDFs. That join is the whole point; a file
service that cannot see your invoices can never answer it.

Migration: `0065_files.sql`. Screen: **Workspace → Files**.

## What runs where

| Input | How it is read | Status recorded | Cost |
|---|---|---|---|
| PDF with a text layer | `pdfjs-dist`, locally | `text_layer` | none |
| DOCX | `mammoth`, locally | `text_layer` | none |
| XLSX / XLSM | `lib/files/office.ts`, locally | `text_layer` | none |
| PPTX (slides + speaker notes) | `lib/files/office.ts`, locally | `text_layer` | none |
| txt / md / csv / json / html / xml / yaml / log | UTF-8 decode | `text_layer` | none |
| Photo of a receipt, scanned image | self-hosted vision endpoint or MinerU, **if configured** | `ocr` | none (your own server) |
| Scanned PDF | self-hosted MinerU, **if configured** | `ocr` | none (your own server) |
| …with no OCR configured | stored, listed, not searchable by content | `skipped` | none |
| Legacy `.doc` / `.xls` / `.ppt`, archives, unknown | stored, listed, not searchable | `skipped` | none |

### Spreadsheets and decks are ZIPs of XML

`.xlsx` and `.pptx` are read by `lib/files/office.ts` with **no dependency** —
both formats are a ZIP containing XML, and the repo already owns a
dependency-free ZIP reader (`lib/plugins/unzip.ts`, written for the plugin
builder). A spreadsheet library or a native Office binary would bring formula
engines, rendering and a runtime for a job that is "get the words out for a
search index". A native addon would also have to be kept in
`serverComponentsExternalPackages` **and** `outputFileTracingIncludes`, or the
Docker image ships without it and degrades only in production.

Two things it deliberately does not do:

- **Formulas are not evaluated.** A cell yields its stored value — what the file
  actually contains, and what someone opening it would see.
- **Dates stay as the serial numbers xlsx stores them.** Converting one needs
  the workbook's epoch and its display format, and a date guessed wrong in a
  search index is worse than the number it came from.

Most strings in a workbook are not in the sheet: they live once in
`sharedStrings.xml` and the cells hold an index into it. A reader that only
walked the sheets would return the numbers and none of the words — which is
worse than not indexing at all, because search would look like it worked.

Nothing here calls a metered API. That is the same cost rule that governs resume
parsing: extraction and search are Postgres and local libraries, and any AI is
bring-your-own-key.

`skipped` is a real answer, not a silent failure — the row says *why* the body is
empty, and the search tool tells an agent when nothing is indexed so it cannot
conclude "that clause isn't in the contract" from a file it never read.

## Why not `pdf-parse`

`pdf-parse` bundles pdf.js 1.10 (2018), which throws `Invalid PDF structure` on any
PDF using **object streams** — the default for pdf-lib, and for every current version
of Word, Pages and Acrobat. Those documents were failing outright. Extraction now uses
`pdfjs-dist` (`lib/pdf/server-text.ts`), the same engine that renders the previews in
the PDF editor. The CV parser (`lib/extract-text.ts`) was switched over too: it had
the same defect, which meant modern PDF resumes were stored with empty
`resume_raw_text` and could never be found by keyword search.

## Optional OCR — two backends, both self-hosted

Scans need OCR, and every hosted OCR API meters per page. So OCR is **opt-in and
self-hosted**, and the backend is pluggable. Set one of these:

```
# A. Any OpenAI-compatible vision endpoint — this is how vLLM and SGLang serve
#    Baidu's Unlimited-OCR (MIT) and DeepSeek-OCR. Needs an NVIDIA GPU.
OCR_API_URL=http://gpu-box:8000/v1
OCR_MODEL=unlimited-ocr        # defaults to "unlimited-ocr"
OCR_API_KEY=…                  # optional

# B. MinerU (below). Has a CPU-only backend, so no GPU required.
MINERU_URL=http://mineru.internal:8000
```

`OCR_API_URL` wins if both are set — those models read layout and tables far
better than a classical pipeline.

**They are not interchangeable.** The vision endpoint accepts *images*: OpenAI
chat-completions takes image content parts, not PDF bytes, and rasterising a PDF
server-side would mean a native canvas dependency. **A scanned PDF therefore
still needs `MINERU_URL`** — with only the vision endpoint configured, a scanned
PDF is recorded `skipped` and says so. Photos and scanned images work with
either. Running both covers everything.

Nothing about the integration is specific to one model beyond `OCR_MODEL`, which
is why it is a generic endpoint rather than a named one — point it at whatever
you serve.

## MinerU specifically

Scans need OCR, and every hosted OCR API meters per page. So OCR is **opt-in and
self-hosted**: point RunButter at your own [MinerU](https://github.com/opendatalab/MinerU)
instance and photos and scans become searchable at no per-page cost. Leave it unset and
everything else still works.

```
MINERU_URL=http://mineru.internal:8000     # base URL, no path
MINERU_TOKEN=…                             # optional bearer token
```

RunButter POSTs the file to `POST {MINERU_URL}/file_parse` with `backend=pipeline`
(the CPU-only backend — no GPU assumed, 16 GB RAM minimum) and reads the Markdown out
of the reply. The request and the response are both handled loosely, because MinerU's
API has changed shape between releases.

The OCR hop is bounded at three minutes; a timeout or an unreachable service is
recorded as `failed` with the reason, and the **Re-index** button retries just that
step without re-uploading.

### Licence and attribution — required

MinerU is **Apache-2.0 with additional conditions**. Two matter:

1. **Scale thresholds.** Commercial use requires a separate licence above 100 M MAU or
   US$20 M monthly revenue. RunButter is far below both.
2. **Attribution is mandatory for a service.** Any product using MinerU must
   "prominently disclose the usage in the relevant product or service interface or in
   publicly available documentation". Non-compliance terminates the licence
   automatically.

That disclosure is rendered on the **Files** screen and stated in this document. If
you fork RunButter and keep the MinerU integration, keep the credit — a code comment
does not satisfy the condition.

## Storage and access

Files go into a **private** Supabase bucket (`files`), created on demand. There is no
public URL: these are contracts and payroll. Opening one mints a signed URL valid for
**two minutes**, after re-checking workspace membership in Postgres.

Deleting removes the row and then the object. `delete_file` returns the storage path
precisely so the blob can be cleaned up — deleting only the row would leave storage
you keep paying for and can no longer see.

## Search behaviour

`search_files` uses `websearch_to_tsquery`, so quoted phrases and `OR` work the way a
search box implies, and odd punctuation never throws. The `tsvector` uses the
**`simple`** configuration rather than `english`: one workspace holds Polish, German and
English documents, and an English stemmer mangles the others. Exact-ish matching across
languages beats good stemming in one.

Snippets come from `ts_headline` with `«»` as delimiters rather than `<b>`, so the UI
renders them as React nodes instead of interpolating HTML built from document text we
did not write.

## Agent / MCP access

Three read-only tools (`lib/agents/tools.ts`): `search_files`, `list_files`,
`get_file_text`. Search results carry `linked_object` / `linked_id`, so a hit can be
joined straight back to the company or invoice it belongs to using the CRUD tools.
