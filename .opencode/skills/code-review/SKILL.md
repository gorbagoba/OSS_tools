---
name: code-review
description: Code review checklist: security, performance, correctness, a11y, TypeScript.
---
# Code Review Playbook

## Review Checklist
- [ ] **Correctness**: Logic sound, edge cases handled
- [ ] **TypeScript-strict**: No `any`, proper types, `strict: true`
- [ ] **Security**: No secrets, proper validation, escaping
- [ ] **Performance**: No unnecessary re-renders, proper memoization
- [ ] **A11y**: Keyboard nav, ARIA, contrast, semantic HTML
- [ ] **Maintainability**: Clear names, no duplication, comments where needed

## Tools to use
- `migrate-to-shoehorn` for safe test assertions (no `as`/`as unknown as`)
- `typescript-advanced-types` for proper generic usage
- `typescript-pro` for advanced patterns

## Red flags
- Magic numbers/strings
- Long functions (>50 lines)
- Global state without reason
- Missing error handling
