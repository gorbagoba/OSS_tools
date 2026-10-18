# BUILD.md — Gate G4 (Build/Verify)

Date: 2026-10-18 · Repo: `C:\Users\user\bg-remover` · PROJECT_TYPE: frontend-only

## Verdict: **G4 GREEN**

| Check | Command | Result |
|---|---|---|
| Production build | `pnpm run build` (`tsc --noEmit && vite build`) | PASS — vite build ~6.9s, dist/ emitted |
| Preview serves | `pnpm run preview -- --port 4175 --strictPort` | PASS — HTTP 200, body = built index.html (`<title>Photo Tools</title>`) |
| README works | every quickstart/script command executed | PASS — see below |
| Fresh install | `pnpm install --frozen-lockfile` | PASS — "Lockfile is up to date" (pnpm 12.10.1) |
| Full gate re-run | `pnpm run typecheck` + `pnpm run lint` + `pnpm run test` | PASS — 0 / 0 / 4 of 4 e2e (7.7s) |

## README command verification (devops, stage 5)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm dev` | exit 0 (spawned as Playwright webServer on 5174 during test run) |
| `pnpm test` | exit 0, 4/4 |
| `pnpm typecheck`, `pnpm lint`, `pnpm lint:fix` | exit 0 |
| `pnpm build`, `pnpm preview` | exit 0, HTTP 200 |
| `node e2e/verify.mjs`, `node e2e/model-test.mjs` | syntax-check only (`node --check` exit 0) — manual scripts, trigger ~115MB ModNet download on execution |

Known harness gotcha: running the preview command through `cmd /c` mangles the
`--` separator (vite falls back to 4173); direct PowerShell invocation works.
README commands as written are correct.

## Build notes

- `build` script changed `tsc && vite build` → `tsc --noEmit && vite build`
  (old script emitted tsc output into dist/ which vite then wiped — wasteful).
- Vite warnings (expected, non-blocking): index chunk >500 kB (859 kB — app +
  transformers.js lazy chunks) and onnxruntime wasm asset ~26.8 MB (inherent to
  ModNet background removal in-browser).
- pnpm 12 requires `pnpm-workspace.yaml` `allowBuilds` policy for dependency
  build scripts (esbuild / onnxruntime-node / protobufjs denied by project
  no-builds intent). File must stay committed for fresh-clone installs to pass.
- Git: repo initialized (branch `main`), husky v9 wired via `prepare: husky`
  (core.hooksPath=.husky/_). Initial commit covers all tracked files;
  node_modules/dist/browser-profile caches excluded via .gitignore.

## Full gate summary (G1–G4)

| Gate | Status | Evidence |
|---|---|---|
| G1 | PASS | docs/PRD.md — goals + 9 user stories + acceptance criteria table |
| G2 | PASS | docs/ARCHITECTURE.md — tree + component inventory; no API_CONTRACT (frontend-only) |
| G3 | PASS | docs/TEST_RESULTS.md — tsc 0, eslint 0, 4/4 e2e |
| G4 | PASS | this file — build + preview + README verified |
