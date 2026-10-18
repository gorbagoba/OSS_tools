---
name: playwright
description: Playwright best practices: selectors, waitForSelector, networkidle, reporting.
---
# Playwright Playbook

## Selectors (in order of preference)
1. `role` (button, link, heading)
2. `text` (exact or regexp)
3. `data-testid` (stable, semantic)
4. CSS as last resort

## waitFor patterns
```typescript
await page.waitForSelector('.selector', { state: 'visible' });
await page.waitForLoadState('networkidle');
await page.waitForTimeout(500); // only if necessary
```

## Test structure
```typescript
test.describe('Feature', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/path');
  });

  test('does X', async ({ page }) => {
    await page.fill('input', 'value');
    await page.click('button:has-text("Save")');
    await expect(page.locator('.success')).toBeVisible();
  });
});
```

## Reporting
- HTML report: `pnpx playwright show-report`
- JSON: `pnpx playwright test --reporter=json`
- Include test results in docs/TEST_RESULTS.md

## For this app
- Base URL: `http://localhost:5174` (aligned with dev server)
- Run against dev server (`pnpx playwright test --ui` for interactive)
