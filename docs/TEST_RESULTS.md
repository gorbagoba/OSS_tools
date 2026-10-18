# Test Results — Gate G3 (Smoke)

Date: 2026-10-18
Repo: `C:\Users\user\bg-remover` (React 19 + TypeScript + Vite, "Photo Tools")
Runner: `@playwright/test` 1.64.1, chromium project only, dev server via `pnpm run dev` (Vite, port 5174)
Browser install: no revision mismatch — no `playwright install chromium` needed.

## Gate G3 verdict: **GREEN (pass)** — after 2 follow-up app fixes

First run was RED (3/4, a11y mount announcement under StrictMode). Orchestrator
applied two app fixes (below), re-ran the full gate: **4/4 pass**, typecheck 0,
lint 0. Final verified run: `pnpm run test` → `4 passed (8.0s)`.

## Checks

| # | Check | Command | Exit code | Result |
|---|-------|---------|-----------|--------|
| 1 | Typecheck | `pnpm run typecheck` (`tsc --noEmit`) | 0 | **PASS** (0 errors) |
| 2 | Lint | `pnpm run lint` (`eslint src`) | 0 | **PASS** (0 warnings/errors) |
| 3 | E2E smoke | `pnpm run test` (`playwright test`) | 0 | **PASS** — 4 passed (8.0s) |

Note: `tsconfig.json` includes only `src/**/*`, so `tsc --noEmit` covers
source files only; the new `e2e/` specs and `playwright.config.ts` are
transpiled (not typechecked) by the Playwright runner. `eslint src` does not
lint `e2e/`.

## E2E test results (playwright list reporter, chromium)

| Test | File | Result | Duration |
|------|------|--------|----------|
| app loads, nav + no console errors | `e2e/smoke.spec.ts:56` | PASS | 1.4s |
| QR renders modules | `e2e/smoke.spec.ts:75` | PASS | 1.2s |
| photo editor: worker active + grayscale + reset persists | `e2e/smoke.spec.ts:113` | PASS | ~1.0s |
| no spurious a11y announcement on mount | `e2e/smoke.spec.ts:199` | PASS | 2.0s |

Total: **4 passed, 0 failed** (8.0s run).

## Coverage

No E2E coverage instrumentation is configured in this repo (no istanbul /
@playwright coverage provider in `package.json`). Effective coverage for this
gate = the 4 smoke scenarios above:

- Covered: app boot + nav + console cleanliness, QR generation pipeline,
  PhotoEditor upload → worker handshake → worker-processed grayscale → reset
  persistence (localStorage), mount-time a11y announcement.
- **Exclusions (deliberate):**
  - **ModNet background-removal pipeline** — requires the ~115MB model
    download. Manual only: `e2e/verify.mjs` (and `e2e/model-test.mjs`).
    Excluded from the gate; `e2e` scripts `*.mjs` are outside `testMatch
    '*.spec.ts'`.
  - **Worker-pool edge cases** — pool error/recovery, message transfer
    failures, `resetPool()`, pool resize, and the StrictMode double-init
    sequence (see Observation O1 below) are not exercised by smoke tests.
  - No visual/regression, a11y-tree (axe), or responsive checks in this gate.

## First-run failing case — FIXED (app-level, exact failure preserved below)

Test: `no spurious a11y announcement on mount`
(`e2e/smoke.spec.ts:199`)

Exact error:

```
Error: live regions contain: ["Processing complete.","Navigated to Background Remover"]

expect(received).not.toContain(expected) // indexOf

Expected substring: not "Processing complete"
Received string:        "Processing complete. Navigated to Background Remover"
```

Test flow: fresh context → `GET /` → wait 1500 ms for mount-time
announcements to settle → read `textContent` of every
`div.sr-only[role="status"]` live region → assert none contains
`Processing complete`. The A11yProvider region (inside `#root`) contained
`Processing complete.` on a plain page load with zero user interaction.

### Root cause (app bug, not test bug)

- `src/main.tsx` renders the app inside `<React.StrictMode>`. In dev,
  StrictMode double-invokes effects (mount → cleanup → remount) with refs
  preserved.
- `src/components/A11yProvider.tsx` guards its `isProcessing` announcement
  effect with a `firstRun` ref:

  ```ts
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    if (isProcessing) announce('Processing started. Please wait.', 'low');
    else              announce('Processing complete.', 'low');
  }, [isProcessing, announce]);
  ```

  The guard is consumed by the **first** effect run; on the **second**
  (StrictMode remount) run `firstRun.current === false` and
  `isProcessing === false`, so `announce('Processing complete.')` fires
  ~50 ms after mount. The region keeps that text (nothing clears it).
- The second live region (the legitimate one) is the `useA11y` hook
  announcer (`src/hooks/useA11y.ts`, `id="announcer-<random>"` appended to
  `<body>`), which correctly shows only
  `Navigated to Background Remover` — confirming the test observes real,
  settled state rather than a race.

Conclusion: the "no announcement on mount" fix works for a single
(non-StrictMode/production) mount but **does not hold under React.StrictMode
dev**, which is exactly what the QA gate runs against.

### Applied fix (orchestrator, post-QA)

`src/components/A11yProvider.tsx`: replaced the `firstRun` ref guard with
transition-based announcement (the semantically correct behavior — only
announce "Processing complete." after a real `isProcessing` true→false
transition):

```ts
const wasProcessing = useRef(false);
useEffect(() => {
  if (isProcessing) {
    wasProcessing.current = true;
    announce('Processing started. Please wait.', 'low');
  } else if (wasProcessing.current) {
    wasProcessing.current = false;
    announce('Processing complete.', 'low');
  }
}, [isProcessing, announce]);
```

StrictMode-safe: double-invoked dev effect sees the same state twice and the
ref stays `false` at mount → no announcement. Re-run: test 4 PASS.

## Passing tests — what they assert

1. **app loads, nav + no console errors** — `GET /`; 3
   `role="menuitem"` nav links with exact texts `Background Remover` /
   `Photo Editor` / `QR Generator` (Layout menubar); `role="main"` visible;
   zero console `error` messages and zero uncaught page errors. (Favicon
   404 — `index.html` declares no icon — is neutralized test-side via a
   204 route so the assertion measures app errors only.)
2. **QR renders modules** — `GET /qr-generator`; fill the content input
   (placeholder `Enter text, URL, or contact info...`); poll canvas
   `getImageData` past the 200 ms debounce until both dark (<128 luminance)
   and light (>=128) module pixel counts are > 0; zero console errors.
3. **photo editor: worker active + grayscale + reset persists** —
   `GET /photo-editor`; `setInputFiles` on the hidden file input with
   `e2e/fixtures/gradient.png` (32×32); canvas visible and sized; badge
   reaches exact text `Worker Active` (pool init handshake) within 10 s;
   Brightness slider (first `input[type=range]`) set to 50 via native value
   setter + `input` event; click `Grayscale`; poll ≥256 sampled pixels all
   satisfying `|r-g|<=2 && |g-b|<=2` (worker-processed grayscale under a
   non-zero adjustment); click `Reset All`; slider back to `0`;
   `localStorage['bgremover_photo_editor_settings']` parsed to
   `{brightness:0, contrast:0, saturation:0, exposure:0, lastFilter:'none'}`;
   zero console errors.

## Observations (non-blocking, out of smoke scope)

- **O1 — worker pool StrictMode double-init: FIXED + verified behaviorally.**
  Root cause had two parts, both fixed by the orchestrator in
  `src/hooks/useWorker.ts`: (a) the auto-init effect carried
  `terminateWorkers` cleanup with `status.ready` in its deps → once the init
  handshake started working (Bug B1 fix), ready flipping true triggered
  teardown + re-init in an infinite create/destroy loop — fixed by splitting
  into an init effect (deps: `status.supported`, `status.ready`,
  `initializeWorkers`) and an unmount-only cleanup effect (stable
  `terminateWorkers`); (b) a stale first init's 5 s timeout rejection would
  clobber the newer pool's status (`ready:false, error:'Worker initialization
  timeout'`) — fixed with an `initGenRef` generation guard: only the latest
  `initializeWorkers()` call may write status. Verified with a temporary
  spec (upload on `/photo-editor`, wait 6.5 s past the stale-init window,
  assert badge still `Worker Active`, zero console errors) — **PASS**, then
  removed the spec.
- **O2 — QR generation effect re-schedules on every render:**
  `useQRGenerator`'s debounce effect depends on the inline `config` object,
  so any render resets the 200 ms timer. No user-visible bug found; noted
  for hygiene.
- **O3 — duplicate a11y systems:** `A11yProvider` (context + live region in
  `#root`) and the `useA11y` hook (imperative body-level announcer) both
  create live regions; `Layout` uses the hook, not the provider context.
  Consolidation recommended (also relevant to the O0 fix above).

## Artifacts created this stage

- `playwright.config.ts` (root) — `testDir ./e2e`, `testMatch *.spec.ts`
  (excludes `e2e/verify.mjs`, `e2e/model-test.mjs` — untouched), webServer
  `pnpm run dev` / `http://localhost:5174` / `reuseExistingServer: true` /
  `strictPort: true`, `baseURL http://localhost:5174`, 30 s timeout,
  `list` reporter, chromium-only project.
- `e2e/smoke.spec.ts` — 4 smoke tests (locators documented in file header).
- `e2e/make-fixture.mjs` — dependency-free PNG generator (node:zlib deflate
  for IDAT + manual CRC32); self-verifies output (signature, per-chunk CRCs,
  dimensions, deflated pixel content, corner-pixel spot checks).
- `e2e/fixtures/gradient.png` — 32×32 opaque RGB horizontal red→blue
  gradient, 173 bytes, commit-ready.
