/**
 * Smoke tests (gate G3) — no model downloads, no background-remover route
 * (ModNet = 115MB download, excluded from the automated gate).
 *
 * Locator sources (read from source at test-authoring time):
 *  - Layout.tsx: nav is a single "Tools" dropdown button (aria-haspopup="menu",
 *    aria-label "Tools menu, current tool: …"). Menu renders 7 role="menuitem"
 *    links grouped Image/Document/Utility: "Background Remover", "Photo Editor",
 *    "Image Compressor", "HEIC → JPG", "MD Converter", "PDF Toolkit",
 *    "QR Generator". <main role="main" id="main-content">.
 *  - QRGenerator.tsx: text input has NO associated label (no htmlFor/id);
 *    it carries placeholder "Enter text, URL, or contact info...".
 *    Generation is debounced 200ms; canvas is the only <canvas> on page.
 *  - PhotoEditor.tsx: hidden <input type="file" accept="image/*"> inside
 *    the "Upload Image" label; preview <canvas> appears after upload.
 *    Worker badge span text: "Worker Active" | "Initializing…" | "Worker Error".
 *    Sliders (DOM order): Brightness, Contrast, Saturation, Exposure —
 *    none are label-associated, so the first range input is Brightness.
 *    Filter buttons: "Grayscale", "Sepia", "Invert", "Blur", "Sharpen",
 *    "Emboss". Reset button: "Reset All".
 *  - storage.ts: prefix "bgremover_" → key "bgremover_photo_editor_settings".
 *    handleReset persists {brightness, contrast, saturation, exposure,
 *    lastFilter: 'none'}.
 *  - A11yProvider.tsx: live region is <div class="sr-only" role="status"
 *    aria-live="polite">.
 */
import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';

const FIXTURE_PNG = path.join(process.cwd(), 'e2e', 'fixtures', 'gradient.png');

/** Collect console errors + uncaught page errors on a page. */
function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
  return errors;
}

/**
 * index.html declares no favicon, so Chromium requests /favicon.ico → 404,
 * which Chromium reports as a console 'error' ("Failed to load resource").
 * That is a missing-asset artifact, not an app JS error — neutralize it so
 * the console assertions measure real app errors only.
 */
async function neutralizeFavicon(page: Page): Promise<void> {
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }));
}

function assertNoConsoleErrors(errors: string[]): void {
  expect(errors, `unexpected console errors: ${JSON.stringify(errors)}`).toHaveLength(0);
}

test('app loads, dropdown nav + no console errors', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await neutralizeFavicon(page);
  await page.goto('/');

  // Layout.tsx: dropdown closed by default; opens via "Tools" button
  const menuButton = page.getByRole('button', { name: /Tools menu/ });
  await expect(menuButton).toBeVisible();
  const menuItems = page.locator('nav [role="menuitem"]');
  await expect(menuItems).toHaveCount(0);

  await menuButton.click();
  await expect(menuItems).toHaveCount(7);
  await expect(menuItems.nth(0)).toHaveText('Background Remover');
  await expect(menuItems.nth(2)).toHaveText('Image Compressor');
  await expect(menuItems.nth(3)).toHaveText('HEIC → JPG');
  await expect(menuItems.nth(4)).toHaveText('MD Converter');
  await expect(menuItems.nth(5)).toHaveText('PDF Toolkit');
  await expect(menuItems.nth(6)).toHaveText('QR Generator');

  // navigating from the menu closes it and lands on the route
  await menuItems.nth(4).click();
  await expect(page).toHaveURL(/convert-to-markdown/);
  await expect(menuItems).toHaveCount(0);

  await expect(page.getByRole('main')).toBeVisible();

  // settle window for late console output (HMR, worker init, etc.)
  await page.waitForTimeout(500);
  assertNoConsoleErrors(errors);
});

test('new tool pages render: PDF Toolkit, Image Compressor, HEIC', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await neutralizeFavicon(page);

  await page.goto('/pdf-toolkit');
  await expect(page.getByRole('heading', { name: 'PDF Toolkit', level: 1 })).toBeVisible();
  await expect(page.getByText('Drop PDFs here, or click to browse')).toBeVisible();

  await page.goto('/image-compressor');
  await expect(page.getByRole('heading', { name: 'Image Compressor', level: 1 })).toBeVisible();
  await expect(page.locator('#ic-format')).toBeVisible();

  await page.goto('/heic-converter');
  await expect(page.getByRole('heading', { name: 'HEIC → JPG Converter', level: 1 })).toBeVisible();
  await expect(page.locator('#heic-quality')).toBeVisible();

  await page.waitForTimeout(300);
  assertNoConsoleErrors(errors);
});

test('QR renders modules', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await neutralizeFavicon(page);
  await page.goto('/qr-generator');

  const contentInput = page.getByPlaceholder('Enter text, URL, or contact info...');
  await expect(contentInput).toBeVisible();
  await contentInput.fill('https://qa-gate.example/smoke');

  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();

  // component debounces generation 200ms; poll until the QR contains both
  // dark (<128 luminance) and light (>=128 luminance) modules
  await expect
    .poll(
      () =>
        canvas.evaluate((c) => {
          const ctx = c.getContext('2d');
          if (!ctx || c.width === 0 || c.height === 0) return false;
          const data = ctx.getImageData(0, 0, c.width, c.height).data;
          let dark = 0;
          let light = 0;
          for (let i = 0; i < data.length; i += 4) {
            const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            if (lum < 128) dark += 1;
            else light += 1;
          }
          return dark > 0 && light > 0;
        }),
      { timeout: 10_000, message: 'QR canvas should contain dark and light modules' },
    )
    .toBe(true);

  await page.waitForTimeout(300);
  assertNoConsoleErrors(errors);
});

test('photo editor: worker active + grayscale + reset', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await neutralizeFavicon(page);
  await page.goto('/photo-editor');

  // upload the 32x32 gradient fixture (hidden file input in "Upload Image" label)
  await page.locator('input[type="file"]').setInputFiles(FIXTURE_PNG);

  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect
    .poll(() => canvas.evaluate((c) => c.width > 0 && c.height > 0), {
      timeout: 10_000,
      message: 'preview canvas should be sized to the uploaded image',
    })
    .toBe(true);

  // worker pool init handshake (init → ready) must complete; badge flips to "Worker Active"
  const badge = page.getByText('Worker Active', { exact: true });
  await expect
    .poll(() => badge.count(), {
      timeout: 10_000,
      message: 'worker badge should read "Worker Active" after pool init',
    })
    .toBeGreaterThan(0);

  // move Brightness off its default (0) so the reset is observable
  // (sliders are not label-associated; DOM order = brightness, contrast, saturation, exposure)
  const brightness = page.locator('input[type="range"]').first();
  await brightness.evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    if (!setter) throw new Error('HTMLInputElement value setter not found');
    setter.call(el, '50');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(brightness).toHaveValue('50');

  // grayscale filter (processed in the worker pool)
  await expect(badge).toBeVisible(); // re-check right before the worker-dependent action
  await page.getByRole('button', { name: 'Grayscale', exact: true }).click();

  // sample >= 100 pixels (stride 4 → 256 samples on the 32x32 canvas):
  // grayscale means |r-g| <= 2 && |g-b| <= 2
  await expect
    .poll(
      () =>
        canvas.evaluate((c) => {
          const ctx = c.getContext('2d');
          if (!ctx) return false;
          const data = ctx.getImageData(0, 0, c.width, c.height).data;
          let samples = 0;
          for (let i = 0; i < data.length; i += 16) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            if (Math.abs(r - g) > 2 || Math.abs(g - b) > 2) return false;
            samples += 1;
          }
          return samples >= 100;
        }),
      { timeout: 10_000, message: 'canvas should be grayscale after Grayscale filter' },
    )
    .toBe(true);

  // reset: Brightness slider back to default (0); persistence was removed
  // (settings were write-only — nothing ever restored them on load)
  await page.getByRole('button', { name: 'Reset All', exact: true }).click();
  await expect(brightness).toHaveValue('0');

  await page.waitForTimeout(300);
  assertNoConsoleErrors(errors);
});

test('no spurious a11y announcement on mount', async ({ page }) => {
  await neutralizeFavicon(page);
  await page.goto('/');

  // Two live-region systems exist:
  //  1. A11yProvider region: <div class="sr-only" role="status" aria-live="polite">
  //     rendered inside #root (watches isProcessing; the fix under test).
  //  2. useA11y hook announcer: <div class="sr-only" role="status"
  //     id="announcer-<random>"> appended to <body> (used by Layout for
  //     route-change announcements).
  // Assert neither ever shows the spurious mount-time announcement.
  const regions = page.locator('div.sr-only[role="status"]');
  await expect(regions).toHaveCount(2);

  // let mount-time announcements settle (announce() writes at +50ms;
  // any stray "Processing complete." would land in the provider region)
  await page.waitForTimeout(1500);

  const liveTexts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('div.sr-only[role="status"]')).map(
      (el) => el.textContent ?? '',
    ),
  );
  expect(
    liveTexts.join('\u0000'),
    `live regions contain: ${JSON.stringify(liveTexts)}`,
  ).not.toContain('Processing complete');
});
