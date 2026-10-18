# Architecture — Photo Tools

Frontend-only SPA (`PROJECT_TYPE=frontend-only`): client-only, no API → no API_CONTRACT.md, no backend. All processing runs in the browser.

## Stack

- React 19 + TypeScript 5.6 (strict, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noUnusedLocals`)
- Vite 5 (outDir `dist`, `base './'`, sourcemaps, dev port 5174) · pnpm 12 canonical · Tailwind 3 + PostCSS
- react-router-dom 7 (BrowserRouter, 3 routes) · @huggingface/transformers 4 (ModNet `Xenova/modnet`) · lean-qr (lazy import)
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
│   ├── app.tsx               # Router + Layout; / · /photo-editor · /qr-generator
│   ├── removal.ts, tailwind.css  # ModNet pipeline (module cache) → transparent PNG blob
│   ├── api/, db/             # empty dead dirs (no server; removal candidates)
│   ├── components/           # Layout, A11yProvider, BackgroundRemover, PhotoEditor, QRGenerator,
│   │                         # Spinner, ErrorBoundary, withErrorBoundary, index
│   ├── hooks/                # useWorker, useQRGenerator, useA11y, index
│   ├── lib/                  # filters, worker, storage, a11y, validators, features, index
│   ├── types/                # filters, worker, models, events, components, index, filesystem.d.ts
│   └── workers/utils.ts      # FilterType + worker message types + kernels/convolution
└── e2e/
    ├── verify.mjs            # manual full pipeline (Chromium, ~115 MB model) — excluded from gate
    ├── model-test.mjs/.html  # ModNet download/inference diagnostics
    └── .browser-profile*/    # browser profile cache (junk; H5: gitignore)
```

## Components & modules inventory

| Path | Responsibility |
|---|---|
| `src/main.tsx` + `src/app.tsx` | Bootstrap (StrictMode > A11yProvider > App); routes `/`, `/photo-editor`, `/qr-generator` |
| `src/removal.ts` | ModNet `pipeline('image-segmentation','Xenova/modnet')` (module cache); RawImage → mask.resize → putAlpha → PNG blob |
| `components/Layout.tsx` | Nav (3 links), skip link, route-change announcement |
| `components/A11yProvider.tsx` | aria-live context: `announce(msg, priority)` + isProcessing |
| `components/BackgroundRemover.tsx` | Paste/drop → removeBackground → preview; PNG download/copy; activity log + ETA |
| `components/PhotoEditor.tsx` | Upload → canvas; 4 sliders (main thread); 6 filters via worker pool w/ main-thread fallback; badge, metrics, reset, download |
| `components/QRGenerator.tsx` | Text/size/ECC/color → debounced QR canvas; download/copy; localStorage persistence |
| `components/Spinner.tsx` · `ErrorBoundary.tsx` · `withErrorBoundary.tsx` | Loading indicator; error UI + HOC (available, not yet mounted in app tree) |
| `hooks/useWorker.ts` | 4-worker pool; inline Blob-URL worker; init/ready handshake (5s timeout); round-robin, transferable buffers, metrics |
| `hooks/useQRGenerator.ts` | Lazy `import('lean-qr')`; dpr-scaled canvas; 200 ms debounce; download/copy/reset |
| `hooks/useA11y.ts` | Standalone sr-only announcer + skip-link focus state |
| `lib/filters.ts` | Main-thread filters (grayscale/sepia/invert; radius-based separable blur/sharpen/emboss) + brightness/contrast/exposure/saturation |
| `lib/worker.ts` | Transferable helpers, pool sizing, kernels (duplicates workers/utils) |
| `lib/storage.ts` | localStorage JSON, `bgremover_` prefix: qr_config, photo_editor_settings, user_preferences, recent_images |
| `lib/a11y.ts` · `validators.ts` · `features.ts` | Focus-trap/contrast/reduced-motion utils; input validators; browser feature detection |
| `workers/utils.ts` | Canonical FilterType + WorkerMessage/Result/Error; separable convolution; transferables |
| `types/*` | Shared types (models, worker, events, component props) |

## Data flows

1. **BG removal**: File (paste/drop) → `URL.createObjectURL` preview → `removeBackground(file)`: cached ModNet pipeline → `RawImage.fromBlob` → segmentation → `mask.resize` → `clone().putAlpha(mask)` → `toBlob('image/png')` → object URL → download/copy; log + ETA in component state.
2. **Photo editor**: File → FileReader → Image → canvas `getImageData` → `originalImageData`. Sliders: `applyAdjustments` (main thread) → `putImageData`. Filters: `processWithWorker` (pool, transferable) → null/error → `applyFilter` fallback (main thread) → canvas.
3. **QR**: config state → 200 ms debounce → `import('lean-qr')` → `generate()` → `toCanvas` (dpr-scaled, RGBA on/off, padding) → CSS-sized canvas; download `toDataURL`, copy `ClipboardItem`; settings → localStorage `qr_config`.

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

- ModNet: ~115 MB first-run download (fp16), module-level pipeline cache + browser cache; onnxruntime-web (WASM/WebGL) inference.
- Filters: transferable ArrayBuffers (zero-copy), 4-worker round-robin, O(n) separable convolution (blur radius 2); cheap per-pixel adjustments stay on main thread.
- QR: lazy import (code-split), dpr-scaled canvas for Retina, 200 ms debounce. Vite: dynamic-import splitting, sourcemaps, `base './'`.

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
