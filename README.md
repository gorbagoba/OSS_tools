# Photo Tools

Browser-based photo tools that run entirely in your browser — no backend,
no accounts, and images never leave the browser. Includes a background
remover (ModNet model via `@huggingface/transformers`; the ~115 MB model is
downloaded on first use and all processing is client-side), a photo editor
(brightness/contrast/exposure sliders plus 6 filters processed in a
4-worker pool), and a QR code generator.

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
| `pnpm preview` | Serve the production build locally |
| `pnpm lint` | ESLint over `src/` |
| `pnpm lint:fix` | ESLint with autofix |
| `pnpm typecheck` | TypeScript check, no emit |
| `pnpm test` | Playwright e2e smoke suite (chromium) |

## Testing

- `pnpm test` runs `e2e/smoke.spec.ts` — 4 scenarios (app load, QR render,
  photo editor worker + filter + reset persistence, a11y). No model
  downloads; fast.
- Full manual pipeline check, including ModNet background removal
  (downloads the ~115 MB model on first run):

  ```bash
  node e2e/verify.mjs
  ```

- Diagnostics for the model loading pipeline: `node e2e/model-test.mjs`.

## Project layout

```
src/
  components/   # React UI: BackgroundRemover, PhotoEditor, QRGenerator, layout, a11y
  hooks/        # useWorker (worker pool), useQRGenerator, useA11y
  lib/          # filters, worker-pool utils, storage, validators, feature flags
  workers/      # shared worker code
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
