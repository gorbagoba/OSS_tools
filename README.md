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

## Testing

- `pnpm test` runs `e2e/smoke.spec.ts` + `e2e/mask-refine.spec.ts` —
  13 tests (dropdown nav, new tool pages, QR render, photo editor worker +
  filter + reset persistence, mask refine math, a11y). No model downloads;
  fast.
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
  lib/          # filters, doclingClient, pdfTools, compactImages, logger, storage, validators
  workers/      # doclingConvert.worker + shared worker code
  types/        # shared TypeScript types
e2e/            # Playwright smoke spec, manual verify/model-test scripts, fixtures
docs/           # PRD, ARCHITECTURE, TASKS, TEST_RESULTS
```

## Notes

- The background remover needs internet **on first use only** — the ModNet
  model (~115 MB) is downloaded then and reused afterwards.
- The photo editor's worker pool runs filters in Web Workers created from
  inline Blob URLs, with an automatic main-thread fallback when Workers
  are unavailable.
- The PDF to Markdown converter uses `@pdf2md/core` for client-side PDF
  processing. Large files (>50MB) may take several seconds to process.
