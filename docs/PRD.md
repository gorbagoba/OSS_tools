# OSS Tools — PRD

Frontend-only web app (React 19 + TypeScript + Vite 5 + Tailwind 3). Four client-side tools: background remover, photo editor, QR generator, and document converter (PDF/PPTX → Markdown). No backend, no accounts. This PRD captures the current product as shipped plus the fixes delivered in this build (worker pool repair, reset persistence fix, a11y announcement fix, e2e smoke tests, repo hygiene).

## Goals

1. **Client-side privacy**: all processing runs in the browser; photos and documents never leave the device.
2. **Working parallel filters**: photo filters execute in a real Web Worker pool (4 workers) with correct convolution kernels, not silently on the main thread.
3. **Honest UI state**: worker status badge, progress logs, and a11y announcements reflect actual state (no false "active" claims, no spurious announcements).
4. **Reliable deliverables**: transparent PNG / adjusted image / QR code / Markdown file are downloadable and copyable, and reset restores exactly the saved defaults.
5. **Verifiable build**: `pnpm typecheck`, `pnpm lint`, `pnpm playwright test`, and `pnpm build` all pass (gates G3/G4).
6. **Responsive conversion**: document conversion overlaps rasterization with model inference and runs inference multi-threaded (cross-origin isolation), so the UI stays responsive and multi-page conversions finish faster.

## User Stories

### Background Remover (/)

- As a content creator, I want to paste or drop a photo and get a transparent PNG, so that I can use cut-out subjects without external tools. Acceptance: after drop, processing progress is shown and a downloadable transparent PNG (alpha channel present on cut-out pixels) is offered.
- As a first-time user, I want to see model download progress (~115 MB on first use), so that I know the app is working, not frozen. Acceptance: progress percentage is visible during the initial ModNet download via @huggingface/transformers.
- As a user, I want to copy the result to the clipboard, so that I can paste it directly into another app. Acceptance: copy action triggers a clipboard write and a success/error notice.

### Photo Editor (/photo-editor)

- As a user, I want live slider adjustments for brightness, contrast, saturation, and exposure on a canvas preview, so that I can see the effect before saving. Acceptance: moving any slider updates the canvas preview without reload; values render as labeled controls.
- As a user, I want filters (grayscale, sepia, invert, blur, sharpen, emboss) to run in a worker pool, so that the UI stays responsive on large images. Acceptance: worker status badge reads "active" and remains accurate (workers answer the init handshake); filters produce correct convolution output (e.g., grayscale reduces per-pixel color variance).
- As a user, I want reset to restore and persist the saved default settings, so that "reset" means what it says. Acceptance: after changing sliders/filters then resetting, UI controls show defaults AND persisted settings equal the defaults (not the pre-reset values).

### QR Generator (/qr-generator)

- As a user, I want to type text and get a QR code with size, error-correction level, and fg/bg colors, so that I can brand the code. Acceptance: changing size/ECC/colors re-renders the QR (debounced); controls are labeled.
- As a user, I want to download or copy the QR, so that I can share it. Acceptance: download yields a QR image file; copy places image on clipboard with feedback.
- As a returning user, I want my QR settings to persist, so that I do not reconfigure every visit. Acceptance: settings are stored in localStorage and restored on reload.

### MD Converter (/convert-to-markdown)

- As a student, I want to drop a PDF and get structured Markdown (headings, lists, tables, and embedded images), so that I can study/edit notes. Acceptance: after upload, page progress is shown; a Markdown preview fills; images from the PDF appear as data URIs in the output.
- As a student, I want to drop a PPTX deck and get one Markdown section per slide, so that I can reuse lecture content. Acceptance: slide progress is shown; output has a heading per slide; download/copy work.
- As a first-time user, I want to see model download progress (~78 MB, first conversion only), so that I know the app is working, not frozen. Acceptance: progress bar shows MB downloaded during the initial layout/OCR model fetch, then the models are cached.
- As a user with a scanned PDF, I want OCR to extract text, so that scans convert too. Acceptance: the pipeline auto-falls back to the OCR converter and shows a scanned-mode notice.
- As a user, I want conversion to stay responsive, so that I can keep browsing. Acceptance: rasterization overlaps model inference (1-deep pipeline) and inference runs multi-threaded when cross-origin isolated.
- As a user, I want to convert Word documents (.docx), so that I can reuse text content. Acceptance: dropping a .docx produces Markdown (headings, lists, tables, images) without downloading AI models.

### PDF Toolkit (/pdf-toolkit)

- As a user, I want to merge multiple PDFs, so that I can combine documents. Acceptance: after adding 2+ PDFs, "Merge all" downloads a single PDF containing every page in order.
- As a user, I want to select specific pages across documents by clicking thumbnails, so that I can extract or act on just those pages. Acceptance: clicked thumbnails show an order badge (#N); "Extract selected" downloads a PDF with only those pages in click order; "Delete selected"/"Rotate selected 90°" download one edited copy per affected document.
- As a user, I want to bundle PNG/JPG images into a PDF, so that I can share scans as one file. Acceptance: "Images → PDF" downloads images.pdf with one page per image at native size.
- As a privacy-conscious user, I want all PDF processing local, so that documents never leave my device. Acceptance: no network requests contain document bytes (pdf.js renders thumbnails locally; pdf-lib runs in-page via dynamic import).

### Image Compressor (/image-compressor)

- As a user, I want to batch re-encode images (WebP/JPEG/PNG/AVIF) with a quality slider, so that I can make files smaller. Acceptance: dropping multiple images processes them sequentially; each row shows original → compressed size with a savings %; downloads work individually and via "Download all".
- As a user, I want optional max-width downscaling, so that large photos fit my target. Acceptance: setting max width caps output dimensions; leaving it blank keeps original size.
- As a user, I want a warning when re-encoding gained nothing, so that I don't ship a bigger file. Acceptance: outputs not smaller than the original are flagged in the row.

### HEIC → JPG (/heic-converter)

- As an iPhone user, I want to convert .heic/.heif photos to JPEG, so that they open anywhere. Acceptance: dropping HEIC files produces JPEG outputs with preview thumbnails; multi-page HEICs produce one JPEG per page; quality slider controls JPEG quality.
- As a user, I want batch conversion with per-output downloads, so that I can convert a whole camera roll. Acceptance: multiple files convert sequentially; each output has its own Download button; input files never leave the device.

### Terminal MD Converter (CLI, `pnpm run md-convert`)

- As a user with very large PDFs, I want to convert them from the terminal with native (non-wasm) speed and maximum fidelity, so that conversion is not limited by browser resources and formatting survives. Acceptance: `pnpm run md-convert -- <files-or-folders> [flags]` defaults to the full pipeline (layout model recovers headings/tables, verbatim casing) and converts PDF/PPTX/DOCX recursively with a live timestamped log (per-page + per-file + summary); `--fast`/`--auto` trade fidelity for speed; models load once and stay warm across the batch; `.md` files are written next to sources (or into `--out`); exit code 1 if any file failed.
- As a web-page user hitting the wasm ceiling, I want to be pointed to the terminal converter, so that I can switch for big files. Acceptance: the MD Converter page shows a "Very large PDF?" note linking to `docs/terminal-converter.md` with the command example.

## Acceptance Criteria

| Story | Verifiable criterion (Playwright e2e) |
|---|---|
| BG: drop photo → PNG | Drop image on dropzone → progress announced → download link appears; downloaded PNG has transparent pixels in cut-out region |
| BG: model download progress | On first use, progress % text updates during ~115 MB ModNet download |
| BG: copy result | Click copy → clipboard contains image data, success notice shown |
| Editor: live sliders | Change brightness slider → canvas pixel values change; no page reload |
| Editor: worker pool real | Worker status badge = "active"; init handshake answered (no timeout); grayscale/sharpen output differs from input and matches expected kernel behavior |
| Editor: reset persists | Change settings → reset → controls show defaults; reload → defaults still persisted (pre-reset values NOT restored) |
| QR: text → canvas | Enter text → canvas contains both dark and light modules; changing size/ECC recolors/re-renders |
| QR: download/copy | Download yields QR file; copy succeeds with feedback |
| QR: persistence | Set size/color → reload → same values restored |
| MD: PDF → Markdown | Drop PDF → progress → Markdown textarea contains text from the PDF; download yields .md file |
| MD: PPTX → Markdown | Drop PPTX → slide progress → one heading per slide; download yields .md file |
| MD: model download UX | First conversion shows MB progress for layout/OCR models; later conversions reuse the HTTP cache |
| MD: scanned fallback | Text-layer-less PDF routes to OCR converter; mode notice shown |
| Nav: dropdown | "Tools" button opens menu with 7 items grouped Image/Document/Utility; clicking an item navigates and closes the menu; outside click/Escape close it |
| PDF: merge/extract/rotate/delete/images→pdf | Thumbnails render per added PDF; selection badges show click order; each op downloads the expected output file(s); source files unchanged |
| Compressor: batch re-encode | Format/quality/resize controls apply; rows show sizes + savings; "Download all" works; bigger-than-original outputs flagged |
| HEIC: convert | .heic drop → JPEG thumbnails + per-output download; quality slider honored |
| CLI: batch convert | `node cli/md-convert.mjs` on generated PDFs → per-file `.md` outputs with live log lines; default full pipeline detects headings + preserves casing; `--fast` skips model work; non-PDF paths skipped with notice |
| CLI: webpage pointer | MD Converter page shows terminal-converter docs link with command example |
| A11y: no spurious announcement | Page load → aria-live region does NOT announce "Processing complete" |
| A11y: base support | Skip link reachable by keyboard; focus lands on main content after route change |
| Build health | `tsc --noEmit` clean, eslint clean, e2e smoke suite green, `vite build` succeeds |

## Out of Scope

- Background removal model quality tuning (thresholds, new models)
- i18n / localization
- Auth, accounts, or any backend service
- Mobile/native app
- Batch processing, video processing
- Cloud model hosting (model must stay browser-local)
