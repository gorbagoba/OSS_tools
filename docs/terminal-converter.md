# Terminal MD Converter (CLI)

Batch-convert PDF/PPTX/DOCX to Markdown from the terminal, powered by
[`docling.rs`](https://github.com/docling-project/docling.rs) native Node.js
bindings — the same engine as the web app's MD Converter, but running natively
instead of in a WebAssembly sandbox.

## Why use it instead of the web page?

| | Web page (MD Converter) | Terminal CLI |
|---|---|---|
| Runtime | WebAssembly + browser workers | Native addon (napi), no wasm memory cap |
| Models | Reloaded per session (~78 MB, browser cache) | Loaded **once**, stay warm across the whole batch |
| Large PDFs | Slower — wasm SIMD, worker juggling, page-by-page UI | Much faster — native ONNX Runtime, all CPU threads |
| Batch | Upload many files in the UI (sequential) | Point at a **folder**, recursive, sorted |
| Fidelity | Full pipeline (layout + OCR), headings + tables | Same engine, same fidelity; `--fast` trades headings for speed |
| Output | Per-file downloads | `.md` written next to sources (or one `--out` dir) |

## Setup (one-time)

```sh
pnpm install
```

The first **full** conversion downloads the AI models (layout + OCR, ~250 MB)
into `./.models/` (gitignored). Download them once up front:

```sh
# layout (fp32 + int8), PP-OCRv3 English recognition + dict, text detector
$base = "https://github.com/docling-project/docling.rs/releases/download/models-v1"
"layout_heron.onnx","layout_heron_int8.onnx","ocr_rec_en.onnx","en_dict.txt","ocr_det.onnx" |
  ForEach-Object { curl.exe -sSL -o ".models/$_" "$base/$_" }
```

Or run the official installer (fetches more, incl. TableFormer table
structure — optional, tables fall back to geometric reconstruction without
it) from a POSIX shell:

```sh
curl -fsSL https://raw.githubusercontent.com/docling-project/docling.rs/master/scripts/install/download_dependencies.sh | sh
```

## Usage

```sh
pnpm run md-convert -- <files-or-folders...> [flags]
```

Examples:

```sh
# One file → report.md next to it (full pipeline: layout model recovers
# headings, tables, reading order)
pnpm run md-convert -- report.pdf

# Whole folder (recursive) → .md next to each source
pnpm run md-convert -- ~/scans/

# Everything into one output directory
pnpm run md-convert -- ~/scans/ extra.pdf --out ~/markdown-out/

# Digital PDFs with a text layer: skip models entirely (near-instant,
# but no headings — layout model is what detects them)
pnpm run md-convert -- ~/papers/ --fast

# Per-document choice: text layer when it carries the doc,
# full pipeline + OCR for scanned pages
pnpm run md-convert -- ~/mixed/ --auto
```

Flags:

- `--full` — **default**. Full pipeline: layout model recovers headings,
  tables, picture alt text and reading order. Casing and wording are
  verbatim. First run needs the ~250 MB model download.
- `--auto` — per document: text layer when it carries the doc, full
  pipeline + OCR when it does not. Faster on mixed batches, but digital
  PDFs come out without headings.
- `--fast` — text layer only, no OCR/layout (digital PDFs; near-instant,
  no model download needed). No headings.
- `--out DIR` — write all `.md` files into `DIR` instead of next to sources
- `--lang en|ch` — OCR language (default `en`)
- `--force-ocr` — OCR every page even when it has a text layer
- `--pages A-B` — convert only this page window (PDF)
- `--ocr-scale N` — OCR render scale px/pt (default 2; 3 = sharper, slower)
- `--metadata` — add a YAML front-matter block (title/author/date)
- `--page-breaks` — insert `<!-- page break -->` between pages
- `--no-images` — replace embedded images with placeholders
- `--help` — full flag list

Fidelity notes: text is verbatim (casing preserved); output is
front-matter-enabled, strict Markdown; TableFormer runs by default for
tables (falls back to geometric reconstruction without the optional model);
images are embedded as data URIs unless `--no-images`.

Supported inputs: `.pdf`, `.pptx`, `.docx`. Exit code is `1` if any file
failed (the rest still convert; failures are listed at the end).

## Progress output

Live log — one timestamped line per event, appended in real time (works
in CI/non-TTY too, unlike the old single-line progress bar):

```
10:41:15 ▶ 12 file(s) · full pipeline (layout + OCR)
10:41:15 ▶ [ 3 /12] thesis.pdf · pdf
10:41:17 · [ 3 /12] thesis.pdf page 148/240
10:41:19 ✔ [ 3 /12] thesis.pdf → ~/scans/thesis.md · 2s · 1.6 pages/s
10:45:33 ■ Converted 12 of 12 in 4m 18s · 21.3 pages/s
```

## Notes

- Models live in `./.models/` (gitignored). To relocate, set the `DOCLING_*`
  env vars — see the
  [docling.rs docs](https://github.com/docling-project/docling.rs).
- Add TableFormer for high-fidelity table extraction by re-running the
  official installer above.
- The web page links here: the MD Converter UI shows this docs link for
  users hitting the wasm performance ceiling.
