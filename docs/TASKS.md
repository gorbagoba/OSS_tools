# TASKS — Audit Fix Sweep (post ponytail-audit)

Mode: orchestrator (ponytail full). Two parallel implementers, disjoint files.
Source: ponytail-audit report (20 findings). Smallest fix per finding; prefer deletion.

## T1 — frontend-ui (agent: frontend)
Owns: `src/components/*` (except none), `src/lib/pdfTools.ts`.
| # | Finding | Fix |
|---|---|---|
| 1 | ImageCompressor.tsx:122-123 toast counts files added, not succeeded | count status 'done' |
| 2 | PDFToolkit: pages 51+ unselectable (MAX_THUMBS_PER_DOC) | numbered page chips beyond cap |
| 3 | ConvertToMarkdown.tsx:137-141 unmount doesn't abort docling worker | `doclingRef.current?.abort()` in cleanup |
| 4 | PhotoEditor.tsx:200-211 write-only settings + fake "Avg Transfer" (140, 383-389) | delete settings persistence + metric |
| 5 | QRGenerator.tsx:53-63 save on download + per-keystroke saves + dead copyQR | drop download-save, debounce effect, remove copyQR |
| 6 | Layout.tsx:40-48 pathMap labels ≠ TOOLS labels | derive announce from TOOLS, delete pathMap |
| 7 | BackgroundRemover.tsx:92-93 closure isProcessing guard | ref guard |
| 8 | HeicConverter.tsx:88-99 + ImageCompressor.tsx:128-139 no running guard | early return + toast while busy |
| 9 | Object URLs not revoked on unmount (BackgroundRemover, HeicConverter) | unmount cleanups |
| 10 | ConvertToMarkdown reset block ×3 (371-384, 454-470, 540-556) | one resetConversionState() callback |
Acceptance: `pnpm run typecheck` + `pnpm run lint` clean (0 errors; warnings only if pre-existing).

## T2 — core-libs (agent: general)
Owns: `src/hooks/*`, `src/lib/{validators,storage,doclingClient}.ts`, `src/types/*`, `src/workers/*` (photo worker), `src/main.tsx`, `vite.config.ts`, `playwright.config.ts`, `package.json`.
| # | Finding | Fix |
|---|---|---|
| 11 | useWorker.ts:112-188 no request ids (race) | id in message, match in listener |
| 12 | useWorker.ts:229-389 inline worker re-implements 6 filters | move worker to `?worker` module importing filters.ts (verify filters.ts is DOM-free; smoke test covers photo editor grayscale) |
| 13 | useWorker.ts:391-399 blob URL leak | revoke on pool teardown |
| 14 | validators.ts 226L dead | delete file |
| 15 | storage.ts ~200L dead + duplicated QR defaults | keep getStorageItem/setStorageItem/saveQRConfig only |
| 16 | types: models.ts + filesystem.d.ts dead; worker.ts/events.ts trim; useQRWithPreview dead (useQRGenerator.ts:225-262) | delete/trim |
| 17 | ErrorBoundary not mounted; withErrorBoundary + barrels dead | wrap `<App/>` in main.tsx, delete withErrorBoundary.tsx + components/index.ts + hooks/index.ts |
| 18 | doclingClient.ts:427-444 error dropped when no wait armed → hang | surface via handlers.onError when running |
| 19 | classifyDoc extracts text twice on fast path | classifyDoc returns per-page markdown; extractTextMarkdown reuses |
| 20 | vite.config.ts:31 @pdf2md/core comment + playwright.config.ts verify.mjs comment stale | update |
| 21 | husky + lint-staged installed, zero hooks | remove deps + prepare script |
Acceptance: same as T1.

## T3 — orchestrator: gates
- `pnpm run typecheck` → `pnpm run lint` → `pnpm run test` (13/13) → `pnpm run build`.
- Conflict check between T1/T2 edits (imports: PhotoEditor/QRGenerator ↔ storage.ts; photo editor ↔ useWorker API).

## Skipped by design
- No new deps. No behavior features. Docs (PRD/ARCHITECTURE/README) untouched — no user-facing feature changes.
