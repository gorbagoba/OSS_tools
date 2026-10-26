# Test Results

## Summary

| Stage | Status |
| --- | --- |
| Tests (Playwright) | ✅ 24/24 passed |
| Typecheck | ✅ Passed |
| Lint | ✅ Passed (0 errors, 0 warnings) |
| Production Build | ✅ Built (8.8s, 683 modules) |

## Test Execution

### Playwright E2E Tests (chromium)

Latest run (24 passed, 10.4s, 3 workers):

| Spec | Tests | Coverage |
| --- | --- | --- |
| `e2e/mask-refine.spec.ts` | 8 | Mask refinement algorithms: grow, feather, alphaBoost, channel handling, bounds validation |
| `e2e/smoke.spec.ts` | 5 | Dropdown nav + console-error watch, new tool pages render, QR modules, photo editor worker, a11y mount |
| `e2e/tools.spec.ts` | 11 | MD Converter single + batch PDF→MD (real downloads), legacy route redirects, PDF Toolkit (merge/extract/rotate+delete/images→PDF), Image Compressor, HEIC rejection toast, QR download naming |

Helpers: `e2e/make-fixture.mjs` generates `e2e/fixtures/gradient.png`; `tools.spec.ts` builds text-layer PDFs at runtime via pdf-lib.

## Build Verification

### Production Build Output (key chunks)

```
dist/assets/index-2AAeW6y9.js        1,199.56 kB (gzip: 357.67 kB)
dist/assets/index-3uEcpffg.js          436.84 kB (gzip: 181.12 kB, pdf-lib)
dist/assets/index-0-IXl67R.js          304.30 kB (gzip:  98.57 kB, mammoth, lazy)
dist/assets/heic2any-Blbre6cY.js     1,352.89 kB (gzip: 341.25 kB, lazy)
dist/assets/encode-baYmOH9c.js          2.29 kB (avif encoder entry, lazy)
dist/assets/photo.worker-FWk1VN59.js    2.53 kB
dist/assets/doclingConvert.worker-*.js 94.91 kB
dist/assets/pdf.worker.min-*.mjs     1,232.30 kB
dist/assets/docling_wasm_bg-*.wasm   16,995.97 kB (lazy)
dist/assets/ort-wasm-simd-threaded.asyncify-*.wasm 26,861.78 kB (lazy)
```

**Note**: Heavy wasm/ML chunks are lazy-loaded on first tool use; the initial page load only ships the main bundle.

### Preview Server

`pnpm run preview` serves `dist/` on `http://localhost:4174/` (strictPort; COOP/COEP headers included, required for the docling wasm worker).

## Failing Cases

**None** — all tests passed.

## Gate Status

| Gate | Status | Details |
| --- | --- | --- |
| G1 (PRD) | ✅ | Requirements documented in PRD.md |
| G2 (Architecture) | ✅ | Architecture documented (frontend-only, no API contract needed) |
| G3 (Tests) | ✅ | Typecheck clean, lint clean, all 24 tests pass |
| G4 (Build) | ✅ | Production build succeeds, preview runs |
