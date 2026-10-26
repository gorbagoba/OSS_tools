# OSS Tools

Browser-based tools that run entirely in your browser — no backend,
no accounts, and files never leave the browser. Seven tools, grouped in
the nav dropdown:

- **Image** — Background Remover (ModNet model via `@huggingface/transformers`;
  the ~115 MB model is downloaded on first use), Photo Editor
  (brightness/contrast/exposure sliders plus 6 filters processed in a
  4-worker pool), Image Compressor (WebP/JPEG/PNG/AVIF re-encoding with
  quality + resize control), HEIC → JPG (libheif via `heic2any`, loaded on
  first use)
- **Document** — MD Converter (PDF/PPTX/DOCX → Markdown via
  docling.rs-wasm in a worker; PDF images compacted to WebP), PDF Toolkit
  (merge/extract/delete/rotate/images→PDF via `pdf-lib` with pdf.js
  thumbnails)
- **Utility** — QR code generator

## Quick start

```bash
pnpm install
pnpm dev          # dev server on port 5174
```

Then open http://localhost:5174.

> **pnpm is required** — this repo uses `pnpm-lock.yaml` and
> `pnpm-workspace.yaml`. npm and yarn are not supported.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Vite dev server (port 5174, auto-opens the browser) |
| `pnpm build` | Typecheck (`tsc --noEmit`) + production build to `dist/` |
| `pnpm preview` | Serve the production build locally (port 4174 — never share the dev port; a prod bundle reloaded against the dev server breaks pdf.js worker loading) |
| `pnpm lint` | ESLint over `src/` |
| `pnpm lint:fix` | ESLint with autofix |
| `pnpm typecheck` | TypeScript check, no emit |
| `pnpm test` | Playwright e2e smoke suite (chromium) |
| `pnpm run md-convert` | Terminal batch MD converter — PDF/PPTX/DOCX → Markdown natively (see [docs/terminal-converter.md](docs/terminal-converter.md)) |

## Testing

- `pnpm test` runs `e2e/smoke.spec.ts` + `e2e/tools.spec.ts` + `e2e/mask-refine.spec.ts` —
  24 tests (dropdown nav, all tool pages, QR render + download naming, photo editor
  worker + filter, PDF Toolkit merge/extract/rotate/delete, image compression, HEIC
  rejection, MD converter incl. per-file batch with real downloads, mask refine
  math, a11y). No AI model downloads; fast.
- MD Converter (PDF/PPTX) uses docling.rs-wasm in a worker; PDF
  images are compacted to WebP via OffscreenCanvas. DOCX is converted with
  `mammoth` (no AI models). Tested manually via browser; downloads ~78 MB
  of AI models on first Accurate-mode run.

- Diagnostics for the model loading pipeline: `node e2e/model-test.mjs`.

## Project layout

```
src/
  components/   # React UI: BackgroundRemover, PhotoEditor, QRGenerator, ConvertToMarkdown, PDFToolkit, ImageCompressor, HeicConverter, ToastProvider, layout, a11y
  hooks/        # useWorker (worker pool), useQRGenerator, useA11y
  lib/          # filters, doclingClient, pdfTools, compactImages, logger, storage
  workers/      # doclingConvert.worker + photo.worker (filter kernels)
  types/        # shared TypeScript types
cli/            # md-convert.mjs — terminal batch converter (docling.rs native bindings)
e2e/            # Playwright specs, fixtures, model-test diagnostics
docs/           # PRD, ARCHITECTURE, TASKS, TEST_RESULTS, terminal-converter
```

## Terminal converter (large PDFs)

The browser MD Converter runs docling in WebAssembly — fine up to mid-size
files, but a wasm memory cap and worker overhead slow very large PDFs. The
CLI runs the same engine **natively** with a warm model pipeline:

```bash
pnpm run md-convert -- ~/scans/ --out ~/markdown-out/
```

Per-page progress + ETA, `.md` written per file, `--fast` for text-layer-only
PDFs. Full guide: [docs/terminal-converter.md](docs/terminal-converter.md).

## Notes

- The background remover needs internet **on first use only** — the ModNet
  model (~115 MB) is downloaded then and reused afterwards.
- The photo editor's worker pool runs filters in `src/workers/photo.worker.ts`
  (Vite module worker importing `lib/filters` kernels), with an automatic
  main-thread fallback when Workers are unavailable.
- The PDF to Markdown converter uses `docling.rs-wasm` (Rust port of docling)
  in a worker for layout-aware conversion with OCR; large files may take a
  while — that is what the [terminal converter](docs/terminal-converter.md)
  is for.
