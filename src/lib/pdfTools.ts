/**
 * Shared helpers for the PDF Toolkit page.
 *
 * Uses the same pdf.js setup pattern as doclingClient (module-level
 * GlobalWorkerOptions.workerSrc) — setting it in both modules is idempotent.
 * pdf-lib is dynamically imported by the page so it stays out of the
 * initial bundle.
 */
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** Thumbnails are rendered at this CSS-px scale relative to page points. */
const THUMB_SCALE = 0.28;

/** Safety cap so a 900-page PDF cannot stall the page with thumbnails. */
const MAX_THUMBS_PER_DOC = 50;

/** Load a PDF from raw bytes (caller keeps ownership of the ArrayBuffer). */
export function loadPdf(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  // pdf.js transfers the buffer; hand it a copy so callers can reuse theirs.
  return pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
}

/**
 * Render thumbnail dataURLs for every page (capped at MAX_THUMBS_PER_DOC).
 * Sequential to keep the pdf.js worker responsive.
 */
export async function renderThumbs(
  pdf: PDFDocumentProxy,
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const total = Math.min(pdf.numPages, MAX_THUMBS_PER_DOC);
  const thumbs: string[] = [];
  for (let n = 1; n <= total; n += 1) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: THUMB_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    thumbs.push(canvas.toDataURL('image/jpeg', 0.75));
    page.cleanup();
    onProgress?.(n, total);
  }
  return thumbs;
}

/** Wrap pdf-lib's Uint8Array output in a Blob (TS-safe ArrayBuffer cast). */
export function pdfBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
}

/** Trigger a browser download for a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Human-readable byte size. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
