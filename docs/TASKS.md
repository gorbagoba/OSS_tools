# TASKS.md — bg-remover ("Photo Tools") fix build

PROJECT_TYPE: frontend-only (no server/api deps → backend stage + API_CONTRACT.md skipped)

## Findings (triage)

**Gates at triage:** typecheck ✅ (exit 0), lint ✅ (exit 0), vite build ✅ (5.8s).
**Broken:** worker pool (real bugs), no tests, no git, no README, mixed lockfiles, dead deps, AGENTS.md quickstart commands broken (`pnpx tsc` resolves fake `tsc` package).

### Bugs
| # | File | Bug |
|---|------|-----|
| B1 | `src/hooks/useWorker.ts` | Inline worker script never answers `{type:'init'}` with `{type:'ready'}` (destructures `data` on init → throws → `error`). All 4 workers time out on every mount. |
| B2 | `src/hooks/useWorker.ts` | Inline convolution hardcodes 3-tap loop for 5-tap Gaussian kernel → wrong blur/sharpen/emboss results when worker is used. |
| B3 | `src/components/PhotoEditor.tsx` | Worker badge probed with a 2x2 image; shows "Worker Active" while hook silently falls back to main thread. Status must come from hook. |
| B4 | `src/components/PhotoEditor.tsx` | `handleReset` persists the OLD (pre-reset) adjustment values. |
| B5 | `src/components/A11yProvider.tsx` | Mount effect fires "Processing complete." announcement on every page load. |

### Hygiene
| # | Item |
|---|------|
| H1 | Mixed lockfiles: `package-lock.json` (npm) alongside canonical `pnpm-lock.yaml` → delete npm one |
| H2 | Unused dep `brighten@0.0.1` in package.json (zero refs) → remove |
| H3 | `build` script runs full `tsc` emit into dist then vite rebuilds → `tsc --noEmit && vite build` |
| H4 | `prepare: husky install` but husky is v9 (wants `husky`) |
| H5 | No `.gitignore` (node_modules, dist, e2e browser-profile caches, test artifacts) |
| H6 | No `README.md` (G4 requires) |
| H7 | No Playwright config + specs; `e2e/` has manual-only scripts (verify.mjs downloads 115MB model — stays manual, excluded from gate) |
| H8 | AGENTS.md quickstart uses broken `pnpx` commands |
| H9 | No git repo |

## Task breakdown

| ID | Task | Owner | Stage | Gate |
|----|------|-------|-------|------|
| T1 | This doc + fix list | orchestrator | 0 | — |
| T2 | Fix B1+B2 worker init/ready + convolution | frontend | 3 | G3 |
| T3 | Fix B3+B4 PhotoEditor status/reset | frontend | 3 | G3 |
| T4 | Fix B5 A11yProvider mount announce | frontend | 3 | G3 |
| T5 | H1–H4 package.json/lockfile/deps | devops | 3 | G3 |
| T6 | H7 playwright.config.ts + e2e smoke specs | qa | 4 | G3 |
| T7 | H5–H6 .gitignore + README | devops | 5 | G4 |
| T8 | H8 AGENTS.md quickstart update | orchestrator | 5 | G4 |
| T9 | H9 git init + initial commit | orchestrator | 5 | G4 |
| G1 | PRD: goals/stories/acceptance | pm | 1 | G1 |
| G2 | ARCHITECTURE.md (frontend-only, no API_CONTRACT) | architect | 2 | G2 |
| G3 | typecheck + lint + all tests pass | qa | 4 | G3 |
| G4 | build + preview + README | devops | 5 | G4 |

## Pipeline
1. Requirements → PRD.md → G1
2. Architecture → ARCHITECTURE.md → G2
3. Implement (T2–T5, parallel: frontend + devops)
4. Test (T6) → G3
5. Build/Verify (T7–T9) → G4
