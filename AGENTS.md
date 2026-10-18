# Team Playbook

## How to launch a build
1. Orchestrator reads the brief → writes docs/TASKS.md
2. Run pipeline: PRD → Architecture → Implement → Test → Build
3. Gates enforced at each stage (typecheck+lint+tests+build)

## Roster
| Agent | Mode | Purpose |
|---|---|---|
| orchestrator | primary | Coordinates, gates, reports |
| pm | subagent | Requirements (PRD) |
| architect | subagent | Architecture, API contracts |
| frontend | subagent | React/TypeScript UI |
| backend | subagent | API/services/db (skipped for frontend-only) |
| qa | subagent | Tests, gates |
| devops | subagent | Configs, build, CI |

## Pipeline stages
1. **Requirements** → PRD.md → Gate G1
2. **Architecture** → ARCHITECTURE.md (+ API_CONTRACT.md if backend) → Gate G2
3. **Implement** (parallel: frontend + backend if needed) → code
4. **Test** → tests + TEST_RESULTS.md → Gate G3
5. **Build/Verify** → configs + BUILD.md → Gate G4

## Gates (all must pass)
- **G1**: PRD has goals + user stories + acceptance criteria
- **G2**: Architecture lists tree + components; API_CONTRACT present iff backend
- **G3**: typecheck clean + lint clean + all tests pass
- **G4**: `vite build` succeeds + preview runs + README works

## Orchestration modes
- **Light (default)**: Orchestrator delegates via `task` tool
- **Heavy**: Orchestrator dispatches Orca workers (own worktrees, threaded messages, decision gates)

## Frontend-only apps
If `package.json` has no server deps (express, fastify, etc.):
- Skip backend stage
- Skip API_CONTRACT.md
- Set `PROJECT_TYPE=frontend-only`

## Quick start
1. `pnpm install` (pnpm is canonical — pnpm-lock.yaml + pnpm-workspace.yaml; npm/yarn unsupported)
2. `pnpm dev` (dev server, port 5174)
3. `pnpm run test` (playwright e2e smoke, chromium)
4. `pnpm run typecheck && pnpm run build` (typecheck + production build)
5. `pnpm run preview` (serve dist)

Note: `pnpx tsc`/`pnpx dev` are NOT reliable here (pnpx can resolve the placeholder `tsc` npm package) — always use `pnpm run` scripts.
