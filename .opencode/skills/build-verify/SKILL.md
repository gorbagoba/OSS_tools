---
name: build-verify
description: Run typecheck, lint, tests, and build; enforce gates.
---
# Build & Verify Playbook

## Gate sequence (must pass in order)
1. `pnpx tsc --noEmit` (typecheck)
2. `pnpx eslint src --ext .ts,.tsx` (lint)
3. `pnpx playwright test` (integration)
4. `pnpx tsc && pnpx vite build` (production build)

## Commands
```bash
pnpx tsc --noEmit --pretty
pnpx eslint src --ext .ts,.tsx --max-warnings=0
pnpx playwright test
pnpx tsc && pnpx vite build
```

## Gate rules
- Typecheck: no errors, no strict warnings
- Lint: 0 warnings, 0 errors (use `--max-warnings=0`)
- Tests: 100% pass rate, >80% coverage recommended
- Build: no warnings, dist contains expected files

## If gate fails
- Fix the issue, don't ignore
- For flaky tests, investigate root cause
- For type errors, add types or fix logic
- Rerun all gates after fixes
