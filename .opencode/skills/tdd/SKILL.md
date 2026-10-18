---
name: tdd
description: Test-Driven Development loop: red, green, refactor.
---
# TDD Playbook

## TDD Loop
1. Write failing test (RED)
2. Write minimal code to pass (GREEN)
3. Refactor with tests passing (REFACTOR)

## When to use Playwright vs Vitest
- **Playwright**: E2E, user flows, browser behavior
- **Vitest/Jest**: Unit, logic, isolated components

## Playwright patterns
- Use `waitForSelector` for dynamic content
- Target `networkidle` for SPA hydration
- Test accessibility roles, not implementation details
- Use test ID attributes for stable selectors

## Gate rules
- All new features must have tests
- Tests must be flake-free and deterministic
- Run before marking code "done"
