# Test Results

## Summary

| Stage | Status |
| --- | --- |
| Tests (Playwright) | ✅ 12/12 passed |
| Typecheck | ✅ Passed |
| Lint | ✅ Passed |
| Production Build | ✅ Built |

## Test Execution

### Playwright E2E Tests (chromium)

```
Running 12 tests using 2 workers

  ✓   1 [chromium] › e2e\mask-refine.spec.ts:8:3 › refineMask › grow: dilates the boundary one pixel into the background (6ms)
  ✓   2 [chromium] › e2e\smoke.spec.ts:56:1 › app loads, nav + no console errors (1.3s)
  ✓   3 [chromium] › e2e\mask-refine.spec.ts:13:3 › refineMask › feather: gaussian-blurs the boundary (1ms)
  ✓   4 [chromium] › e2e\mask-refine.spec.ts:20:3 › refineMask › alphaBoost: lifts mid alpha and clamps at 1 (3ms)
  ✓   5 [chromium] › e2e\mask-refine.spec.ts:27:3 › refineMask › uses channel 0 for interleaved RGBA input (1ms)
  ✓   6 [chromium] › e2e\mask-refine.spec.ts:34:3 › refineMask › 1x1 masks survive default options (1ms)
  ✓   7 [chromium] › e2e\mask-refine.spec.ts:39:3 › refineMask › 2D: vertical bar grows on both sides, not beyond (6ms)
  ✓   8 [chromium] › e2e\mask-refine.spec.ts:56:3 › refineMask › default options keep interior opaque and stay in [0,1] (8ms)
  ✓   9 [chromium] › e2e\mask-refine.spec.ts:67:3 › refineMask › rejects data length that does not match dimensions (6ms)
  ✓  10 [chromium] › e2e\smoke.spec.ts:76:1 › QR renders modules (1.0s)
  ✓  11 [chromium] › e2e\smoke.spec.ts:114:1 › photo editor: worker active + grayscale + reset persists (774ms)
  ✓  12 [chromium] › e2e\smoke.spec.ts:200:1 › no spurious a11y announcement on mount (1.8s)

12 passed (6.9s)
```

### Test Coverage

- `e2e/mask-refine.spec.ts`: 8 tests for mask refinement algorithms (grow, feather, alphaBoost, channel handling)
- `e2e/smoke.spec.ts`: 4 smoke tests for app navigation, QR rendering, photo editor, and a11y

## Build Verification

### Production Build Output

```
dist/
├── index.html                    0.38 kB (gzip: 0.27 kB)
└── assets/
    ├── index-DcL2_aci.css       18.49 kB (gzip: 4.41 kB)
    ├── index-B6Ari2Wd.js         6.98 kB (gzip: 3.73 kB, map: 20.99 kB)
    ├── index-Ckj4qbrR.js      900.97 kB (gzip: 272.42 kB, map: 3,939.41 kB)
    ├── pdf-DeWlx49F.js       458.43 kB (gzip: 136.01 kB, map: 1,489.45 kB)
    ├── pdf-C0-xfYc7.js       517.87 kB (gzip: 156.91 kB, map: 1,804.95 kB)
    ├── pdf.worker.min-iDqQPrd3.mjs 1,232.30 kB
    └── ort-wasm-simd-threaded.asyncify-CxOG5pUO.wasm 26,861.78 kB
```

**Build time**: 6.07s

**Note**: Large chunks (>500 kB) are expected for PDF processing (`pdf.worker.min-iDqQPrd3.mjs` at 1.2 MB). Code-splitting could be applied if needed.

### Preview Server

- Started successfully on `http://localhost:4173/`
- All routes accessible including new `/pdf-to-markdown` endpoint

## Failing Cases

**None** - All tests passed.

## Issues Found & Fixed

1. **Navigation menu item count mismatch**
   - Issue: Test expected 3 menu items, layout had 4 (added "PDF to Markdown")
   - Fix: Updated `e2e/smoke.spec.ts` to expect 4 menu items and verify "PDF to Markdown" link
   - Result: Tests now pass

## Gate Status

| Gate | Status | Details |
| --- | --- | --- |
| G1 (PRD) | ✅ | Requirements documented in PRD.md |
| G2 (Architecture) | ✅ | Architecture and API contracts documented |
| G3 (Tests) | ✅ | Typecheck clean, lint clean, all 12 tests pass |
| G4 (Build) | ✅ | Production build succeeds, preview runs |
