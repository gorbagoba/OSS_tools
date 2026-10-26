# Architecture — OSS Tools

Frontend-only SPA (`PROJECT_TYPE=frontend-only`): client-only, no API → no API_CONTRACT.md, no backend. All processing runs in the browser.

## Stack

- React 19 + TypeScript 5.6 (strict, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noUnusedLocals`)
- Vite 5 (outDir `dist`, `base './'`, sourcemaps, dev port 5174, COOP/COEP cross-origin isolation headers on dev + preview) · pnpm 12 canonical · Tailwind 3 + PostCSS
- react-router-dom 7 (BrowserRouter, 4 routes) · @huggingface/transformers 4 (ModNet `Xenova/modnet` + mask refinement) · lean-qr (lazy import)
- Converter: `docling.rs-wasm 2.46` (DigitalConverter/ScannedConverter) + `onnxruntime-web 1.30` (WASM EP) + `pdfjs-dist 5` (rasterization) + `pptxtojson` (PPTX)
- localStorage via `lib/storage` (`bgremover_` prefix) · ESLint airbnb + jsx-a11y · Prettier · husky v9 · Playwright

## Directory tree

```
bg-remover/
├── index.html                # Vite entry (#root)
├── package.json              # scripts + deps (pnpm canonical)
├── pnpm-lock.yaml, pnpm.config.yaml  # canonical lockfile (ignoreBuilds)
├── package-lock.json         # leftover npm lockfile (H1: delete)
├── tsconfig.json             # TS strict + exactOptionalPropertyTypes + verbatimModuleSyntax
├── vite/tailwind/postcss/eslint/prettier configs, AGENTS.md
├── docs/                     # PRD.md, TASKS.md, ARCHITECTURE.md (this file)
├── dist/                     # build output (H5: gitignore)
├── src/
│   ├── main.tsx              # StrictMode > A11yProvider > App; tailwind.css
│   ├── app.tsx               # Router + Layout; / · /photo-editor · /qr-generator · /convert-to-markdown · /pdf-toolkit · /image-compressor · /heic-converter (+ legacy redirects)
│   ├── removal.ts, tailwind.css  # BiRefNet pipeline (module cache) → mask refine → transparent PNG blob
│   ├── components/           # Layout (Tools dropdown), A11yProvider, BackgroundRemover, PhotoEditor, QRGenerator,
│   │                         # ConvertToMarkdown, PDFToolkit, ImageCompressor, HeicConverter, ToastProvider, Spinner, ErrorBoundary
│   ├── hooks/                # useWorker, useQRGenerator, useA11y, index
│   ├── lib/                  # filters, pdfTools (pdf.js thumbs + helpers), doclingClient, storage, compactImages
│   ├── types/                # filters, worker, models, events, docling, heic2any.d.ts, filesystem.d.ts
│   └── workers/              # doclingConvert.worker.ts (wasm+ORT pipeline)
└── e2e/
    ├── verify.mjs            # manual full pipeline (Chromium, ~115 MB model) — excluded from gate
    ├── model-test.mjs/.html  # ModNet download/inference diagnostics
    └── .browser-profile*/    # browser profile cache (junk; H5: gitignore)
```

## Components & modules inventory

| Path | Responsibility |
|---|---|
| `src/main.tsx` + `src/app.tsx` | Bootstrap (StrictMode > A11yProvider > App); routes `/`, `/photo-editor`, `/qr-generator` |
| `src/removal.ts` | ModNet `pipeline('image-segmentation','Xenova/modnet')` (module cache, fp16); RawImage → mask.resize → `lib/maskRefine` edge cleanup (dilate + feather + alpha boost) → putAlpha → PNG blob |
| `components/Layout.tsx` | Nav: single "Tools" dropdown (role=menu, grouped Image/Document/Utility, closes on outside click/Escape/route change), skip link, route-change announcement |
| `components/A11yProvider.tsx` | aria-live context: `announce(msg, priority)` + isProcessing |
| `components/BackgroundRemover.tsx` | Paste/drop → removeBackground → preview (original + result side-by-side); PNG download/copy; activity log + ETA |
| `components/PhotoEditor.tsx` | Upload → always-mounted canvas (2048px preview downscale); fused adjustments on cached filter base; 6 filters via worker pool w/ main-thread fallback; badge, metrics, reset, download |
| `components/QRGenerator.tsx` | Text/size/ECC/color → debounced QR canvas; download/copy; localStorage persistence |
| `components/ConvertToMarkdown.tsx` | One dropzone for PDF + PPTX (`detectKind` by mime/ext); dispatches to DoclingClient pipeline (PDF) or pptxtojson (PPTX); model-download + page/slide progress; A4/full-width preview; copy/download/reset |
| `components/PDFToolkit.tsx` | Multi-PDF thumbnails (pdf.js via `lib/pdfTools`); click-order page selection; merge/extract/delete/rotate via dynamic `import('pdf-lib')`; images→PDF |
| `components/ImageCompressor.tsx` | Batch re-encode WebP/JPEG/PNG (canvas) + AVIF (dynamic `@jsquash/avif/encode`, wasm); quality + max-width; per-file savings + downloads |
| `components/HeicConverter.tsx` | .heic/.heif → JPEG via dynamic `import('heic2any')` (libheif wasm, lazy); multi-page support; preview grid + per-output download |
| `components/ToastProvider.tsx` | Toast context: `useToast().show(message, variant)`; auto-dismiss stack |
| `components/Spinner.tsx` · `ErrorBoundary.tsx` · `withErrorBoundary.tsx` | Loading indicator; error UI + HOC (available, not yet mounted in app tree) |
| `hooks/useWorker.ts` | 4-worker pool; inline Blob-URL worker; init/ready handshake (5s timeout); round-robin, transferable buffers, metrics |
| `hooks/useQRGenerator.ts` | Lazy `import('lean-qr')`; dpr-scaled canvas; 200 ms debounce; download/copy/reset |
| `hooks/useA11y.ts` | Standalone sr-only announcer + skip-link focus state |
| `lib/filters.ts` | Main-thread filters (grayscale/sepia/invert; radius-based separable blur/sharpen/emboss) + brightness/contrast/exposure/saturation |
| `lib/maskRefine.ts` | Mask post-processing: dilate/erode (grow) → Gaussian feather → alpha boost; pure TS, DOM-free, unit-tested in `e2e/mask-refine.spec.ts` |
| `lib/worker.ts` | Transferable helpers, pool sizing, kernels (duplicates workers/utils) |
| `lib/storage.ts` | localStorage JSON, `bgremover_` prefix: qr_config, photo_editor_settings, user_preferences, recent_images |
| `lib/a11y.ts` · `validators.ts` · `features.ts` | Focus-trap/contrast/reduced-motion utils; input validators; browser feature detection |
| `workers/utils.ts` | Canonical FilterType + WorkerMessage/Result/Error; separable convolution; transferables |
| `workers/doclingConvert.worker.ts` | Owns docling.rs-wasm converters + ORT sessions; fetches models (HF, 3-attempt retry, progress posts); probes text layer → digital vs scanned mode; per-page layout inference; emits markdown with embedded images |
| `lib/doclingClient.ts` | Main-thread driver: pdf.js rasterization (scale 2) + 1-deep lookahead pipeline overlapping raster with inference; worker lifecycle, waits, abort |
| `types/docling.ts` | Worker protocol types (convert/addPage/finish → model/stage/mode/pageDone/done/error) |
| `types/*` | Shared types (models, worker, events, component props) |

## Data flows

1. **BG removal**: File (paste/drop) → `URL.createObjectURL` preview → `removeBackground(file)`: cached ModNet pipeline (fp16) → `RawImage.fromBlob` → segmentation → `mask.resize` → `refineMask` (dilate + feather + alpha boost, rewrites mask alpha) → `clone().putAlpha(mask)` → `toBlob('image/png')` → object URL → download/copy; log + ETA in component state.
2. **Photo editor**: File → FileReader → Image → canvas `getImageData` → `originalImageData`. Sliders: `applyAdjustments` (main thread) → `putImageData`. Filters: `processWithWorker` (pool, transferable) → null/error → `applyFilter` fallback (main thread) → canvas.
3. **QR**: config state → 200 ms debounce → `import('lean-qr')` → `generate()` → `toCanvas` (dpr-scaled, RGBA on/off, padding) → CSS-sized canvas; download `toDataURL`, copy `ClipboardItem`; settings → localStorage `qr_config`.
4. **Document conversion**: File → `detectKind` → PDF: `DoclingClient.convert` (worker copies bytes, pdf.js loads on main; worker probes text layer → DigitalConverter | ScannedConverter; models fetched w/ retry + progress; **1-deep lookahead**: raster page i+1 on main while worker infers page i; per-page RGBA transferred scale 2; layout model finds headings/tables/pictures; `finish` → markdown, images inlined as data URIs) → preview + download. PPTX: pptxtojson parse → one H2 section per slide, image/table placeholders.

## Cross-origin isolation & threading

- `vite.config.ts` sets COOP `same-origin` + COEP `require-corp` on **dev and preview** servers → `crossOriginIsolated = true` → SharedArrayBuffer available.
- ORT: `ort.env.wasm.numThreads = crossOriginIsolated ? min(cores, 8) : 1` → multi-threaded WASM inference for the layout model (the single biggest conversion speedup).
- All cross-origin loads are CORS-mode fetches (HuggingFace models) — permitted under `require-corp`; no `no-cors` subresources exist.

## Worker pool design

- 4 workers (default), each built from an inline JS script via `Blob` + `URL.createObjectURL` (no separate worker chunk).
- Init handshake: main thread posts `{type:'init'}` per worker, awaits `{type:'ready'}`, 5s timeout (`waitForWorkerReady`); any failure → pool `ready=false` + error.
- AS-IS defect (B1/B2 → fixed by T2): script never answers `init` (all workers time out on every mount); convolution hardcodes a 3-tap loop that truncates the 5-tap Gaussian kernel. Fix: answer `{type:'ready'}` to `init`; radius-based separable pass matching `lib/filters` kernels.
- Processing: round-robin; posts `{type:'process', data: transferred ArrayBuffer, width, height, filter}` → `{type:'result'|'error'}` with transferred buffer.
- Fallback: `processWithWorker` returns null when pool not ready or on error → PhotoEditor runs `applyFilter` on the main thread.

## State & storage

- No global store: per-component `useState`/`useRef`; pool handles in refs, pool status in state. Cross-cutting: A11yContext (announce/isProcessing) from A11yProvider.
- Client-only, no API, no server calls. localStorage is the only persistence (JSON, prefixed, safe defaults); `idb` dep unused (H2). Object URLs for previews, revoked on replace/reset.

## Error handling & a11y

- Errors: try/catch per flow surfaced in UI (log entries, status badge, copy/download messages); worker error → reject → main-thread fallback; storage catches quota errors → defaults. `ErrorBoundary`/`withErrorBoundary` available for route-level UI (not yet mounted).
- a11y: sr-only `aria-live` regions (polite/assertive, clear-then-set); skip link (WCAG 2.2); route announcements; labeled controls; eslint `jsx-a11y`; lib/a11y focus/contrast/reduced-motion utils. B5 fix: skip "Processing complete." announce on mount.

## Performance notes

- ModNet: ~115 MB first-run download (fp16), module-level pipeline cache + browser cache; onnxruntime-web (WASM/WebGL) inference. Mask refinement (dilate + feather + alpha boost) removes dark fringe/halos at subject edges.
- Filters: transferable ArrayBuffers (zero-copy), 4-worker round-robin, O(n) separable convolution (blur radius 2); fused single-pass adjustments (brightness→contrast→exposure→saturation) on the cached filter base; cheap per-pixel work stays on main thread; convolution skips alpha (result alpha = source alpha).
- QR: memoized lazy import (code-split), dpr-scaled canvas for Retina, 200 ms debounce, primitive deps to avoid effect churn.
- Conversion: COOP/COEP cross-origin isolation → multi-threaded ORT (2–4× per-page inference); 1-deep raster/inference pipeline overlap (~30–50% wall time); 1-deep ack waits bound memory; model downloads cached + retried (3 attempts, backoff).

## Testing strategy

- Gate G3: Playwright e2e smoke specs (`e2e/*.spec.ts`) + `playwright.config.ts` (webServer: `vite preview` of dist; testMatch `*.spec.ts`) — added in T6; covers PRD acceptance: route renders, worker badge truthful, reset persists defaults, no spurious announcements, QR renders.
- Manual (excluded from gate): `e2e/verify.mjs` full pipeline in real Chromium incl. 115 MB model download; `model-test.mjs/.html` ModNet diagnostics.
- No unit-test runner (no jest/vitest): gates = typecheck + lint + e2e smoke.

## Build & tooling

- pnpm canonical (`pnpm-lock.yaml`; npm `package-lock.json` leftover → H1). Scripts: `dev` (vite :5174), `build`, `preview`, `lint` (eslint src), `typecheck` (tsc --noEmit), `prepare` (husky).
- H3: `build` is `tsc && vite build` (full tsc emit into dist, then vite rebuilds) → this build: `tsc --noEmit && vite build`.
- H4: husky v9 + lint-staged (`prepare: husky install` is v8 syntax; no `.husky/` yet) · H5: no `.gitignore` · H6: no README (G4) · H8: AGENTS.md quickstart uses broken `pnpx` commands · H9: no git repo.

## Fix notes (this build)

- **B1+B2 — worker pool repair (T2)**: inline worker now answers `{type:'init'}` with `{type:'ready'}` (handshake completes; no 5s timeout per mount) + radius-based convolution matching `lib/filters` kernels (old 3-tap loop truncated the 5-tap Gaussian → wrong blur/sharpen/emboss).
- **B3 — honest worker badge (T3)**: PhotoEditor derives status from `useWorker` status, not a 2×2 probe (probe returns null, does not throw → badge falsely showed "Worker Active" while main-thread fallback ran).
- **B4 — reset persists reset values (T3)**: `handleReset` persisted stale pre-reset closure values; now persists the reset defaults.
- **B5 — no mount announce (T4)**: A11yProvider `isProcessing` effect announced "Processing complete." on every page load; mount now skipped.
- **Hygiene (T5–T8)**: delete npm lockfile (H1); remove unused dep `brighten` (also unreferenced: `idb`, `qrcode.react`) (H2); `build` → `tsc --noEmit && vite build` (H3); husky v9 `prepare` + `.husky/` (H4); `.gitignore` (H5); README (H6); playwright config + smoke specs (H7); AGENTS.md quickstart (H8); git init (H9).

## Follow-up: mask refinement (2026-10-18)

Request: "make the model used for the background remover better at edge detection for black borders".

**Mask refinement** — new `src/lib/maskRefine.ts` applied in `removal.ts` between `mask.resize` and `putAlpha`:
1. **grow** (default +1 px): separable box-max dilation — boundary moves 1 px toward the subject so dark fringe pixels become fully part of the cutout instead of a half-transparent halo (the "black border" artifact).
2. **feather** (default 1 px): separable Gaussian (sigma 1, clamped boundaries) smooths the stepped dilation edge.
3. **alphaBoost** (default ×1.12, clamp 1): lifts mid-range alpha, killing residual semi-transparency at the rim.
- Pure TS, DOM-free, classic loops; unit-tested in `e2e/mask-refine.spec.ts` (8 node-context tests, no model download).
- Tuning knob: options object on `refineMask` (negative `grow` erodes if rims are instead over-captured).
- The existing ModNet model continues to power segmentation; refinement post-processes the mask for cleaner edges.

**Alternative models considered**:
- `onnx-community/RMBG-1.4` (isnet) was first candidate but is **gated** on the Hub (401 on `config.json`) → unusable.
- `onnx-community/BiRefNet_lite-ONNX` (fp16 = 114.5 MB) is open, MIT, and produces sharper edges than ModNet, but browser WASM fails with `std::bad_alloc` for larger images (320x320) — likely due to higher model complexity. Browser memory limits (256MB WASM heap default) are exceeded. Node ORT (CPU) handles it, but browser does not.

**Decision**: Keep ModNet for browser compatibility; add mask refinement for edge cleanup. This delivers the user's core request ("better edge detection for black borders") without breaking the browser workflow.
