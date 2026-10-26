/**
 * Rigorous tool tests (gate G3) — real user flows per tool, no model
 * downloads (ModNet 115MB / docling AI 78MB excluded; MD-converter tests
 * use the fast text path, which needs no AI models).
 *
 * Fixture PDFs are generated with pdf-lib (a prod dependency) in the test
 * process and uploaded via setInputFiles.
 *
 * Locator sources (read from source at test-authoring time):
 *  - Layout.tsx: "Tools" dropdown button (aria-label "Tools menu, current
 *    tool: …", aria-haspopup="menu"). Items are role="menuitem" links; menu
 *    closes on outside mousedown, Escape, and route change.
 *  - app.tsx: legacy routes /pdf-to-markdown and /slides-to-markdown
 *    redirect (replace) to /convert-to-markdown.
 *  - ConvertToMarkdown.tsx: hidden input aria-label "Select PDF, PowerPoint,
 *    or Word file for conversion" (multiple, accept .pdf,.pptx,.docx);
 *    preview textarea aria-label "Markdown preview"; Download button labeled
 *    "Download"; batch download name = `${first-file-base}-batch.md`.
 *  - PDFToolkit.tsx: first input[type=file] accepts application/pdf, second
 *    accepts image/png+jpeg; buttons "Merge all (N docs)", "Extract selected
 *    (N)", "Delete selected", "Rotate selected 90°", "Images → PDF"; page
 *    buttons carry aria-label `Page N of ${file.name}`; outputs merged.pdf /
 *    selection.pdf / `${name}-edited.pdf` / `${name}-rotated.pdf` / images.pdf.
 *  - ImageCompressor.tsx: input[type=file] accept image/*; auto-processes on
 *    upload; toast "Compressed X of Y images"; status "N/M compressed";
 *    "Download all (N)" button.
 *  - HeicConverter.tsx: input[type=file] accept .heic/.heif; non-HEIC upload
 *    → toast "No .heic/.heif files found".
 *  - useQRGenerator.ts: downloadQR default filename "qrcode.png".
 *  - A11yProvider/useA11y: live regions are div.sr-only[role="status"]
 *    (provider inside #root, announcer appended to body); Layout announces
 *    "Navigated to <label>" on route change.
 */
import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as fs from 'fs/promises';
import * as path from 'path';

const FIXTURE_PNG = path.join(process.cwd(), 'e2e', 'fixtures', 'gradient.png');

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

async function neutralizeFavicon(page: Page): Promise<void> {
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }));
}

function assertNoConsoleErrors(errors: string[]): void {
  expect(errors, `unexpected console errors: ${JSON.stringify(errors)}`).toHaveLength(0);
}

/** Build a text-layer PDF with `pageCount` pages, each stamped with `token`. */
async function makePdf(pageCount: number, token: string, name: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pageCount; i += 1) {
    const page = doc.addPage([420, 300]);
    page.drawText(`${token} page ${i}`, { x: 40, y: 220, size: 24, font, color: rgb(0.1, 0.1, 0.1) });
  }
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}

/** Load a downloaded file and return its parsed pdf-lib document. */
async function readDownloadedPdf(download: { path: () => Promise<string> }) {
  const bytes = await fs.readFile(await download.path());
  return PDFDocument.load(bytes);
}

test('dropdown nav: Escape and outside click close, route change announces', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await neutralizeFavicon(page);
  await page.goto('/');

  const menuButton = page.getByRole('button', { name: /Tools menu/ });
  const menuItems = page.locator('nav [role="menuitem"]');

  await menuButton.click();
  await expect(menuItems).toHaveCount(7);
  await expect(menuButton).toHaveAttribute('aria-expanded', 'true');

  // Escape closes without navigating
  await page.keyboard.press('Escape');
  await expect(menuItems).toHaveCount(0);
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false');

  // Outside click closes
  await menuButton.click();
  await expect(menuItems).toHaveCount(7);
  await page.mouse.click(20, 400);
  await expect(menuItems).toHaveCount(0);

  // Navigating announces the tool name in a live region
  await menuButton.click();
  await menuItems.nth(5).click(); // PDF Toolkit
  await expect(page).toHaveURL(/pdf-toolkit/);
  await page.waitForTimeout(200);
  const liveTexts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('div.sr-only[role="status"]')).map((el) => el.textContent ?? ''),
  );
  expect(liveTexts.join('\u0000')).toContain('Navigated to PDF Toolkit');

  await page.waitForTimeout(300);
  assertNoConsoleErrors(errors);
});

test('legacy tool routes redirect to MD Converter', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await neutralizeFavicon(page);

  await page.goto('/pdf-to-markdown');
  await expect(page).toHaveURL(/\/convert-to-markdown$/);
  await expect(page.getByRole('heading', { name: 'MD Converter', level: 1 })).toBeVisible();

  await page.goto('/slides-to-markdown');
  await expect(page).toHaveURL(/\/convert-to-markdown$/);
  await expect(page.getByRole('heading', { name: 'MD Converter', level: 1 })).toBeVisible();

  assertNoConsoleErrors(errors);
});

test('MD Converter: single PDF converts via fast path and downloads .md', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await neutralizeFavicon(page);
  await page.goto('/convert-to-markdown');

  const fileInput = page.locator('input[aria-label="Select PDF, PowerPoint, or Word file for conversion"]');
  await fileInput.setInputFiles([await makePdf(2, 'SoloDoc', 'doc1.pdf')]);

  // Auto mode classifies text-only PDFs → fast pdf.js extraction, no models
  const preview = page.locator('textarea[aria-label="Markdown preview"]');
  await expect
    .poll(() => preview.inputValue().then((v) => (v.includes('SoloDoc') ? 'yes' : 'no')), {
      timeout: 20_000,
      message: 'markdown preview should contain the extracted text',
    })
    .toBe('yes');

  // Download keeps the source base name
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('doc1.md');

  assertNoConsoleErrors(errors);
});

test('MD Converter: batch converts PDFs separately with per-file downloads', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await neutralizeFavicon(page);
  await page.goto('/convert-to-markdown');

  const fileInput = page.locator('input[aria-label="Select PDF, PowerPoint, or Word file for conversion"]');
  await fileInput.setInputFiles([
    await makePdf(2, 'Alphadoc', 'batch-a.pdf'),
    await makePdf(2, 'Bravodoc', 'batch-b.pdf'),
  ]);

  // Per-file previews appear with each file's own text
  const previewA = page.locator('textarea[aria-label="Markdown preview for batch-a.pdf"]');
  const previewB = page.locator('textarea[aria-label="Markdown preview for batch-b.pdf"]');
  await expect
    .poll(() => previewA.inputValue().then((v) => (v.includes('Alphadoc') ? 'yes' : 'no')), {
      timeout: 30_000,
      message: 'batch-a markdown should contain its text',
    })
    .toBe('yes');
  await expect
    .poll(() => previewB.inputValue().then((v) => (v.includes('Bravodoc') ? 'yes' : 'no')), {
      timeout: 30_000,
      message: 'batch-b markdown should contain its text',
    })
    .toBe('yes');

  // Download all → one .md per file, named after the source PDF
  const firstPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download all (2)' }).click();
  expect((await firstPromise).suggestedFilename()).toBe('batch-a.md');
  const secondPromise = page.waitForEvent('download');
  expect((await secondPromise).suggestedFilename()).toBe('batch-b.md');

  assertNoConsoleErrors(errors);
});

test('PDF Toolkit: merge all produces one combined PDF', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await neutralizeFavicon(page);
  await page.goto('/pdf-toolkit');

  const pdfInput = page.locator('input[type="file"]').nth(0);
  await pdfInput.setInputFiles([
    await makePdf(3, 'AlphaPdf', 'a.pdf'),
    await makePdf(2, 'BravoPdf', 'b.pdf'),
  ]);

  await expect(page.getByRole('heading', { name: /a\.pdf/ })).toContainText('3 pages');
  await expect(page.getByRole('heading', { name: /b\.pdf/ })).toContainText('2 pages');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Merge all \(2 docs\)/ }).click();
  const merged = await readDownloadedPdf(await downloadPromise);
  expect(merged.getPageCount()).toBe(5);

  assertNoConsoleErrors(errors);
});

test('PDF Toolkit: extract selected pages in click order', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await neutralizeFavicon(page);
  await page.goto('/pdf-toolkit');

  const pdfInput = page.locator('input[type="file"]').nth(0);
  await pdfInput.setInputFiles([await makePdf(3, 'ExtractPdf', 'a.pdf')]);

  const pageBtn = (n: number) => page.getByRole('button', { name: `Page ${n} of a.pdf` });
  await pageBtn(2).click();
  await pageBtn(1).click(); // selection order: page 2 first, then page 1
  await expect(pageBtn(2)).toHaveAttribute('aria-pressed', 'true');
  await expect(pageBtn(1)).toHaveAttribute('aria-pressed', 'true');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Extract selected \(2\)/ }).click();
  const extractDownload = await downloadPromise;
  expect(extractDownload.suggestedFilename()).toBe('selection.pdf');
  const extracted = await readDownloadedPdf(extractDownload);
  expect(extracted.getPageCount()).toBe(2);

  assertNoConsoleErrors(errors);
});

test('PDF Toolkit: rotate and delete selected pages write new files', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await neutralizeFavicon(page);
  await page.goto('/pdf-toolkit');

  const pdfInput = page.locator('input[type="file"]').nth(0);
  await pdfInput.setInputFiles([await makePdf(3, 'ModPdf', 'a.pdf')]);

  const pageBtn = (n: number) => page.getByRole('button', { name: `Page ${n} of a.pdf` });
  await pageBtn(1).click();

  // Rotate page 1 by 90° → a-rotated.pdf with the rotation applied
  const rotatePromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Rotate selected 90°' }).click();
  const rotatedDownload = await rotatePromise;
  expect(rotatedDownload.suggestedFilename()).toBe('a-rotated.pdf');
  const rotated = await readDownloadedPdf(rotatedDownload);
  expect(rotated.getPageCount()).toBe(3);
  expect(rotated.getPage(0).getRotation().angle % 360).toBe(90);

  // Delete page 1 → a-edited.pdf with 2 pages left
  await pageBtn(1).click();
  const deletePromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Delete selected' }).click();
  const deleteDownload = await deletePromise;
  expect(deleteDownload.suggestedFilename()).toBe('a-edited.pdf');
  const edited = await readDownloadedPdf(deleteDownload);
  expect(edited.getPageCount()).toBe(2);

  assertNoConsoleErrors(errors);
});

test('PDF Toolkit: images → PDF embeds one page per image', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await neutralizeFavicon(page);
  await page.goto('/pdf-toolkit');

  await page.getByRole('button', { name: 'Images → PDF' }).click();
  const imgInput = page.locator('input[type="file"]').nth(1);
  await imgInput.setInputFiles(FIXTURE_PNG);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Images → PDF' }).click();
  const imagesPdf = await readDownloadedPdf(await downloadPromise);
  expect(imagesPdf.getPageCount()).toBe(1);
  expect(imagesPdf.getPage(0).getSize().width).toBeGreaterThan(0);

  assertNoConsoleErrors(errors);
});

test('Image Compressor: upload processes file and enables download', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await neutralizeFavicon(page);
  await page.goto('/image-compressor');

  await page.locator('input[type="file"]').setInputFiles(FIXTURE_PNG);

  await expect(page.getByText('Compressed 1 of 1 image')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('1/1 compressed')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download all (1)' })).toBeEnabled();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download all (1)' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.webp$/);

  assertNoConsoleErrors(errors);
});

test('HEIC converter: non-HEIC upload is rejected with an error toast', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await neutralizeFavicon(page);
  await page.goto('/heic-converter');

  await page.locator('input[type="file"]').setInputFiles(FIXTURE_PNG);
  await expect(page.getByText('No .heic/.heif files found')).toBeVisible({ timeout: 5_000 });

  assertNoConsoleErrors(errors);
});

test('QR Generator: downloaded file uses sanitized qrcode name', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await neutralizeFavicon(page);
  await page.goto('/qr-generator');

  await page.getByPlaceholder('Enter text, URL, or contact info...').fill('https://qa-gate.example/tools');
  // Generation is debounced 200ms; wait for it to settle before downloading
  await page.waitForTimeout(600);
  const canvas = page.locator('canvas');
  await expect
    .poll(() => canvas.evaluate((c) => c.width > 0 && c.height > 0), { timeout: 10_000 })
    .toBe(true);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download QR Code' }).click();
  const download = await downloadPromise;
  // Filenames are sanitized (illegal chars → underscores) and truncated to 20 chars
  expect(download.suggestedFilename()).toBe('qrcode-https___qa-gate.exam.png');

  assertNoConsoleErrors(errors);
});
