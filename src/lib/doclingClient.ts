/**
 * Main-thread driver for the docling.rs-wasm conversion pipeline.
 * Rasterizes PDF pages with pdf.js, streams them to the worker, and surfaces
 * model-download, stage, page, and completion progress to the UI.
 * @category lib
 */

import * as pdfjsLib from 'pdfjs-dist';
import { OPS } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { logger } from './logger';
import type {
  ConverterMode, DoclingImageStats, DoclingMode, DoclingRequest, DoclingResponse,
  PagePlan, PagePlanEntry,
} from '../types/docling';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** Raster resolution in pixels per PDF point (matches docling demo scale). */
const RASTER_SCALE = 2;

/**
 * Raster scale for pages with no images or heavy vector content: the layout
 * model consumes a 640x640 tensor regardless, and text comes from the PDF
 * text layer — so a 1x bitmap loses nothing and costs 4x fewer pixels.
 */
const TEXT_RASTER_SCALE = 1;

/** Cap the long raster edge (huge posters/rollups) to bound wasm memory + transfer time. */
const MAX_RASTER_DIM = 2600;

/** Sample window for the rolling per-page ETA average. */
const ETA_WINDOW = 8;

/**
 * Vector-path operations above this on one page hint at diagrams/graphics
 * that the AI pipeline handles better than the declarative text parse.
 */
const PATH_OPS_THRESHOLD = 400;

/** Below this many extracted characters the PDF is treated as a scan. */
const MIN_FAST_CHARS = 20;

/** Result of the cheap per-page document classification. */
interface DocVerdict {
  mode: 'fast' | 'accurate';
  imagePages: number;
  pathPages: number;
  /** Per-page (0-based) flag: page has images or heavy vector content. */
  heavyPages: boolean[];
  /** Per-page flag: page contains raster images. */
  imageFlags: boolean[];
  /** Per-page text-layer character counts (drives OCR fallback decisions). */
  pageChars: number[];
  /** Per-page markdown from the classification pass (reused by the fast path). */
  pageMarkdown: string[];
}

export interface DoclingClientHandlers {
  /** Model/dictionary bytes downloaded. */
  onModelProgress(label: string, got: number, total: number | null): void;
  /** Coarse stage update ('parsing' | 'models'). */
  onStage(stage: string): void;
  /** Pipeline mode resolved; pageCount is the authoritative total. */
  onMode(mode: DoclingMode, pageCount: number): void;
  /** One page finished converting; etaSeconds is a rolling estimate or null. */
  onPageDone(index: number, totalPages: number, etaSeconds: number | null): void;
  /** Human-readable progress line for the live log panel (optional). */
  onLog?(line: string): void;
  /**
   * Custom mode only: the per-page plan is ready; the UI shows a selector
   * and resolves with the 0-based page indices to run through the AI
   * pipeline. Resolve null to cancel the conversion.
   */
  onPagePlan?(plan: PagePlan): Promise<number[] | null>;
  /** Conversion finished. */
  onDone(markdown: string): void;
  /** Conversion failed. */
  onError(message: string, code: string | null): void;
}

function errorCodeFor(message: string): string | null {
  const normalized = message.toLowerCase();
  if (normalized.includes('password')) return 'PASSWORD_PROTECTED';
  if (normalized.includes('invalid') || normalized.includes('corrupt') || normalized.includes('parse')) {
    return 'INVALID_PDF';
  }
  return null;
}

type ModeWait = { mode: DoclingMode; pageCount: number | null };

export class DoclingClient {
  private worker: Worker | null = null;

  private pdfDoc: PDFDocumentProxy | null = null;

  private handlers: DoclingClientHandlers | null = null;

  /** Handlers for the standalone preloadModels() call (outside a conversion). */
  private preloadHandlers: Pick<DoclingClientHandlers, 'onModelProgress' | 'onStage' | 'onLog' | 'onError'> | null = null;

  private modeWait: { resolve: (payload: ModeWait) => void; reject: (err: Error) => void } | null = null;

  /** Resolved when the worker module signals readiness ('ready' message). */
  private readyWait: { resolve: (worker: Worker) => void; reject: (err: Error) => void } | null = null;

  /** Resolves when a preload run finishes caching all models. */
  private preloadWait: { resolve: () => void; reject: (err: Error) => void } | null = null;

  private pageWait: { index: number; resolve: () => void; reject: (err: Error) => void } | null = null;

  private doneWait: { resolve: (payload: { markdown: string; images?: DoclingImageStats }) => void; reject: (err: Error) => void } | null = null;

  /** Resolves with the single-page markdown chunk for convertPage (custom mode). */
  private pageMarkdownWait: { index: number; resolve: (payload: { markdown: string; images?: DoclingImageStats }) => void; reject: (err: Error) => void } | null = null;

  private totalPages = 0;

  private running = false;

  private cancelled = false;

  /** Identifies the active convert() run; stale runs must stay silent. */
  private runId = 0;

  /** pageDone indices that arrived before their wait was armed (race buffer). */
  private earlyPageDone = new Set<number>();

  /** Reused raster canvas + context (avoids per-page DOM canvas churn). */
  private rasterCanvas: HTMLCanvasElement | null = null;

  private rasterContext: CanvasRenderingContext2D | null = null;

  /** Rolling per-page durations (ms) backing the ETA estimate. */
  private pageDeltas: number[] = [];

  /** Per-page raster start timestamps backing the per-page duration log. */
  private pageStarted = new Map<number, number>();

  /** Model labels already announced in the live log (download start line). */
  private modelLogged = new Set<string>();

  /** Wall-clock start of the current conversion (backs the total-elapsed log). */
  private startedAt = 0;

  private log(line: string): void {
    if (this.handlers?.onLog) this.handlers.onLog(line);
    else this.preloadHandlers?.onLog?.(line);
  }

  /**
   * Run a full conversion. Resolves after handlers.onDone/onError fired.
   * pdf.js rasterization stays on the main thread (docling demo constraint);
   * the worker owns wasm + ONNX sessions.
   * `opts.mode`:
   *  - 'fast': pdf.js text-layer extraction, no models, no raster.
   *  - 'accurate': full AI pipeline (layout model + OCR session).
   *  - 'auto' (default): cheap pdf.js operator-list scan classifies the
   *    document and picks fast or accurate (images/vector-heavy → accurate).
   */
  async convert(
    bytes: ArrayBuffer,
    name: string,
    handlers: DoclingClientHandlers,
    opts?: { mode?: ConverterMode; compactImages?: boolean },
  ): Promise<void> {
    if (this.running) this.hardAbort();
    this.handlers = handlers;
    this.running = true;
    this.cancelled = false;
    this.totalPages = 0;
    this.earlyPageDone.clear();
    this.pageDeltas = [];
    this.pageStarted.clear();
    this.modelLogged.clear();
    this.startedAt = performance.now();
    const runId = this.runId + 1;
    this.runId = runId;
    const requested: ConverterMode = opts?.mode ?? 'auto';

    let pdf: PDFDocumentProxy | null = null;
    try {
      // Copy for the docling worker first: pdf.js may detach the original buffer.
      const workerBytes = bytes.slice(0);
      this.log(`Converting ${name} (${formatMB(bytes.byteLength)} MB)${requested === 'accurate' ? ' — accurate mode' : ''}`);
      logger.debug('[docling] convert start', { name, size: bytes.byteLength, mode: requested });
      pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
      logger.debug('[docling] pdf.js loaded', { numPages: pdf.numPages });
      this.log(`PDF parsed: ${pdf.numPages} pages`);
      if (this.cancelled) return;
      this.pdfDoc = pdf;
      this.totalPages = pdf.numPages;

      let fast = requested === 'fast';
      let heavyPages: boolean[] | null = null;
      let verdict: DocVerdict | null = null;
      if (requested === 'auto' || requested === 'custom' || requested === 'accurate') {
        verdict = await classifyDoc(pdf);
        if (this.cancelled) return;
        heavyPages = verdict.heavyPages;
      }
      if (requested === 'auto') {
        fast = verdict?.mode === 'fast';
        if (fast) {
          this.log('Auto mode: no images or vector-heavy pages — fast text extraction');
        } else {
          this.log(`Auto mode: ${verdict?.imagePages ?? 0} page(s) with images, ${verdict?.pathPages ?? 0} vector-heavy — using the AI pipeline`);
        }
      }

      if (fast) {
        this.log('Extracting text layer with pdf.js (no AI models)');
        let markdown: string;
        let totalChars: number;
        if (verdict) {
          // classifyDoc already ran smartPageMarkdown on every page — reuse
          // those results instead of re-extracting (same output format as
          // extractTextMarkdown).
          totalChars = verdict.pageChars.reduce((sum, chars) => sum + chars, 0);
          const title = name.replace(/\.pdf$/i, '');
          markdown = `# ${title}\n\n${verdict.pageMarkdown
            .map((text, i) => `## Page ${i + 1}\n\n${text}`)
            .join('\n\n')}`;
        } else {
          ({ markdown, totalChars } = await extractTextMarkdown(pdf, name));
        }
        if (this.cancelled) return;
        if (totalChars >= MIN_FAST_CHARS) {
          this.log(`Done — ${formatMB(totalChars)} of markdown extracted in ${formatDuration((performance.now() - this.startedAt) / 1000)} (no AI models used)`);
          handlers.onDone(markdown);
          return;
        }
        this.log('No usable text layer found — switching to the AI pipeline (OCR)');
      }

      const worker = await this.ensureWorker();
      if (this.cancelled || runId !== this.runId) return;
      logger.debug('[docling] worker created, sending convert request');
      const request: DoclingRequest = {
        type: 'convert',
        bytes: workerBytes,
        name,
        ...(opts?.compactImages === false ? { compactImages: false } : { compactImages: true }),
      };
      worker.postMessage(request);

      const { mode, pageCount } = await this.waitMode();
      if (this.cancelled) return;
      const total = pageCount != null && pageCount > 0 ? pageCount : this.totalPages;
      this.totalPages = total;
      handlers.onMode(mode, total);
      this.log(`Pipeline: ${mode} mode, ${total} pages`);

      if (requested === 'custom' && handlers.onPagePlan && verdict) {
        const plan = buildPagePlan(pdf.numPages, verdict);
        this.log(`Custom mode: ${plan.pages.filter((p) => p.heavy || p.needsOcr).length} page(s) flagged for the AI pipeline — pick pages to process`);
        const selected = await handlers.onPagePlan(plan);
        if (this.cancelled || selected === null) {
          this.log('Conversion cancelled');
          return;
        }
        const ordered = [...selected].sort((a, b) => a - b);
        if (ordered.length === 0) {
          this.log('No pages selected — fast text extraction only');
          const { markdown, totalChars } = await extractTextMarkdown(pdf, name);
          if (this.cancelled) return;
          this.log(`Done — ${formatMB(totalChars)} of markdown extracted in ${formatDuration((performance.now() - this.startedAt) / 1000)} (no AI models used)`);
          handlers.onDone(markdown);
          return;
        }
        await this.runCustomPipeline(worker, pdf, plan, ordered, handlers, name, mode);
        return;
      }

      await this.runPipeline(worker, total, handlers, name, heavyPages);
    } catch (err) {
      // A superseded run (or an abort) must not surface errors: the run that
      // owns the UI is the one whose id still matches.
      if (!this.cancelled && runId === this.runId) {
        const message = err instanceof Error ? err.message : String(err);
        this.log(`Error: ${message}`);
        handlers.onError(message, errorCodeFor(message));
      }
    } finally {
      this.running = false;
      this.modeWait = null;
      this.pageWait = null;
      this.doneWait = null;
      this.readyWait = null;
      this.pageMarkdownWait = null;
      if (pdf && this.pdfDoc === pdf) {
        this.pdfDoc = null;
        void pdf.destroy();
      }
    }
  }

  /** User-facing cancel. Stops an in-flight conversion (terminating the
   * worker); when idle it only cancels bookkeeping so the worker — and its
   * cached models — survive for the next conversion. */
  abort(): void {
    if (this.running) {
      this.hardAbort();
      return;
    }
    this.cancelled = true;
    this.runId += 1;
    this.earlyPageDone.clear();
    if (this.pdfDoc) {
      void this.pdfDoc.destroy();
      this.pdfDoc = null;
    }
    this.handlers = null;
  }

  /**
   * Download and cache every AI model ahead of any conversion (the worker
   * boots, loads the layout/OCR/dict models, then reports modelsCached).
   * Model download progress is streamed through the given handlers.
   */
  preloadModels(
    handlers: Pick<DoclingClientHandlers, 'onModelProgress' | 'onStage' | 'onLog' | 'onError'>,
  ): Promise<void> {
    if (this.running) return Promise.reject(new Error('A conversion is already running'));
    if (this.preloadWait) return Promise.reject(new Error('Model preload already running'));
    const workerReady = this.ensureWorker();
    const preload = new Promise<void>((resolve, reject) => {
      this.preloadWait = { resolve, reject };
    });
    this.preloadHandlers = handlers;
    return workerReady
      .then((worker) => {
        worker.postMessage({ type: 'preload' } satisfies DoclingRequest);
        return preload;
      })
      .catch((err: unknown) => {
        this.preloadHandlers = null;
        this.preloadWait = null;
        throw err instanceof Error ? err : new Error(String(err));
      });
  }

  private hardAbort(): void {
    this.cancelled = true;
    this.running = false;
    this.runId += 1;
    this.earlyPageDone.clear();
    const abortError = new Error('Conversion aborted');
    this.modeWait?.reject(abortError);
    this.pageWait?.reject(abortError);
    this.doneWait?.reject(abortError);
    this.modeWait = null;
    this.pageWait = null;
    this.doneWait = null;
    this.pageMarkdownWait?.reject(abortError);
    this.pageMarkdownWait = null;
    this.preloadWait?.reject(abortError);
    this.preloadWait = null;
    this.readyWait?.reject(abortError);
    this.readyWait = null;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.pdfDoc) {
      void this.pdfDoc.destroy();
      this.pdfDoc = null;
    }
    this.handlers = null;
  }

  private ensureWorker(): Promise<Worker> {
    if (this.worker && !this.readyWait) return Promise.resolve(this.worker);
    const worker = new Worker(new URL('../workers/doclingConvert.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<DoclingResponse>) => this.handleResponse(event.data);
    worker.onerror = (event: ErrorEvent) => {
      const message = event.message || 'Conversion worker crashed';
      // The worker is dead — drop it so the next run boots a fresh one
      // instead of posting into a corpse.
      if (this.worker === worker) {
        worker.terminate();
        this.worker = null;
      }
      this.handleResponse({ type: 'error', message });
    };
    this.worker = worker;
    return new Promise((resolve, reject) => {
      this.readyWait = { resolve, reject };
    });
  }

  private handleResponse(msg: DoclingResponse): void {
    if (msg.type !== 'model') logger.debug('[docling] <-', msg.type);
    switch (msg.type) {
      case 'ready': {
        const wait = this.readyWait;
        this.readyWait = null;
        if (wait && this.worker) wait.resolve(this.worker);
        break;
      }
      case 'modelsCached': {
        const wait = this.preloadWait;
        this.preloadWait = null;
        this.preloadHandlers = null;
        wait?.resolve();
        break;
      }
      case 'model': {
        if (!this.modelLogged.has(msg.label)) {
          this.modelLogged.add(msg.label);
          const size = msg.total != null ? ` (${formatMB(msg.total)} MB)` : '';
          this.log(`Downloading model "${msg.label}"${size} — first run only, cached afterwards`);
        }
        if (msg.total != null && msg.got >= msg.total) {
          this.log(`Model "${msg.label}" downloaded (${formatMB(msg.got)} MB)`);
        }
        (this.handlers ?? this.preloadHandlers)?.onModelProgress(msg.label, msg.got, msg.total);
        break;
      }
      case 'stage':
        if (msg.stage === 'models') {
          this.log('Preparing AI models (layout + OCR)...');
        }
        (this.handlers ?? this.preloadHandlers)?.onStage(msg.stage);
        break;
      case 'mode': {
        const wait = this.modeWait;
        this.modeWait = null;
        wait?.resolve({ mode: msg.mode, pageCount: msg.pageCount });
        break;
      }
      case 'pageDone': {
        const wait = this.pageWait;
        if (wait && wait.index === msg.index) {
          this.pageWait = null;
          wait.resolve();
        } else {
          // The ack for this page is not armed yet (worker may finish a fast
          // page while the main thread is between loop microtasks). Buffer it
          // so waitPageDone can resolve immediately instead of deadlocking.
          this.earlyPageDone.add(msg.index);
        }
        break;
      }
      case 'done': {
        const wait = this.doneWait;
        this.doneWait = null;
        wait?.resolve({ markdown: msg.markdown, ...(msg.images ? { images: msg.images } : {}) });
        break;
      }
      case 'pageMarkdown': {
        const wait = this.pageMarkdownWait;
        if (wait && wait.index === msg.index) {
          this.pageMarkdownWait = null;
          wait.resolve({ markdown: msg.markdown, ...(msg.images ? { images: msg.images } : {}) });
        }
        break;
      }
      case 'error': {
        const error = new Error(msg.message);
        const { modeWait } = this;
        const { pageWait } = this;
        const { doneWait } = this;
        const { pageMarkdownWait } = this;
        const { preloadWait } = this;
        this.modeWait = null;
        this.pageWait = null;
        this.doneWait = null;
        this.pageMarkdownWait = null;
        this.preloadWait = null;
        if (preloadWait) preloadWait.reject(error);
        else if (modeWait) modeWait.reject(error);
        else if (pageWait) pageWait.reject(error);
        else if (doneWait) doneWait.reject(error);
        else if (pageMarkdownWait) pageMarkdownWait.reject(error);
        else {
          // No wait armed but work is in flight (e.g. worker crash between
          // pipeline stages): surface the error instead of dropping it and
          // leaving convert() hanging forever. Cancelling the run keeps the
          // abandoned loop from arming new waits; the readyWait rejection
          // covers a crash during worker boot.
          this.readyWait?.reject(error);
          this.readyWait = null;
          if (this.running) {
            this.cancelled = true;
            this.running = false;
            this.log(`Error: ${msg.message}`);
            this.handlers?.onError(msg.message, errorCodeFor(msg.message));
          }
        }
        break;
      }
      default:
        break;
    }
  }

  private waitMode(): Promise<ModeWait> {
    return new Promise((resolve, reject) => {
      this.modeWait = { resolve, reject };
    });
  }

  private waitPageDone(index: number): Promise<void> {
    if (this.earlyPageDone.has(index)) {
      this.earlyPageDone.delete(index);
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.pageWait = { index, resolve, reject };
    });
  }

  private waitDone(): Promise<{ markdown: string; images?: DoclingImageStats }> {
    return new Promise((resolve, reject) => {
      this.doneWait = { resolve, reject };
    });
  }

  /** Arm-before-send wait for a single-page markdown chunk (custom mode). */
  private waitPageMarkdown(index: number): Promise<{ markdown: string; images?: DoclingImageStats }> {
    return new Promise((resolve, reject) => {
      this.pageMarkdownWait = { index, resolve, reject };
    });
  }

  /** Shared ML pipeline: serialized rasters overlapping worker inference. */
  private async runPipeline(
    worker: Worker,
    total: number,
    handlers: DoclingClientHandlers,
    name: string,
    heavyPages: boolean[] | null,
  ): Promise<void> {
    // Software pipeline, 1-deep: render page i, then START rendering page
    // i+1 while the worker infers page i. Renders never overlap each other
    // (they share one canvas), but each render overlaps the previous
    // page's wasm/ONNX inference.
    let next: Promise<void> | null = null;
    try {
      for (let index = 0; index < total; index += 1) {
        if (this.cancelled) return;
        const current = next ?? this.rasterizeAndSend(index, heavyPages);
        // Detached swallow-branch: an error path that abandons this raster
        // must not surface an unhandled rejection (the await below still
        // receives the real rejection).
        current.catch(() => {});
        // Arm the ack wait BEFORE awaiting: the worker may finish page
        // `index` while the next raster is rendering. Early arrivals are
        // buffered and resolved by waitPageDone.
        const ack = this.waitPageDone(index);
        await current;
        if (this.cancelled) return;
        next = index + 1 < total ? this.rasterizeAndSend(index + 1, heavyPages) : null;
        if (next) next.catch(() => {});
        await ack;
        const pageStarted = this.pageStarted.get(index);
        const delta = pageStarted != null ? performance.now() - pageStarted : 0;
        this.pageDeltas.push(delta);
        if (this.pageDeltas.length > ETA_WINDOW) this.pageDeltas.shift();
        const remaining = total - index - 1;
        const etaSeconds = remaining > 0
          ? ((this.pageDeltas.reduce((sum, d) => sum + d, 0) / this.pageDeltas.length) * remaining) / 1000
          : null;
        const avgSeconds = this.pageDeltas.reduce((sum, d) => sum + d, 0) / this.pageDeltas.length / 1000;
        const etaNote = etaSeconds != null
          ? ` — avg ${avgSeconds.toFixed(1)}s/page, ~${formatDuration(etaSeconds)} left`
          : '';
        this.log(`Page ${index + 1}/${total} converted in ${(delta / 1000).toFixed(1)}s${etaNote}`);
        handlers.onPageDone(index, total, etaSeconds);
      }
    } finally {
      next?.catch(() => {});
    }

    this.log('Assembling markdown document...');
    worker.postMessage({ type: 'finish', name } satisfies DoclingRequest);
    const { markdown, images } = await this.waitDone();
    if (this.cancelled) return;
    if (images) {
      const ratio = images.before > 0 ? Math.round((images.after / images.before) * 100) : 100;
      this.log(`Compacted ${images.count} embedded image(s): ${formatMB(images.before)} → ${formatMB(images.after)} of data URIs (${ratio}%, ${images.format})`);
    }
    this.log(`Done — ${formatMB(markdown.length)} of markdown in ${formatDuration((performance.now() - this.startedAt) / 1000)}`);
    handlers.onDone(markdown);
  }

  private async rasterizeAndSend(index: number, heavyPages: boolean[] | null): Promise<void> {
    const raster = await this.rasterize(index, heavyPages);
    const { worker } = this;
    if (!worker) throw new Error('Converter is not active');
    const request: DoclingRequest = {
      type: 'addPage',
      index,
      rgba: raster.rgba,
      width: raster.width,
      height: raster.height,
      scale: raster.scale,
    };
    worker.postMessage(request, [raster.rgba]);
  }

  /**
   * Render one page into the shared canvas and grab its RGBA buffer.
   * Adaptive raster resolution: heavy pages (images/vector) keep the full
   * 2x bitmap for crisp picture crops; text-only pages raster at 1x since
   * the layout model downsamples to 640x640 and text comes from the text
   * layer anyway. Caps the long edge on huge pages in both cases.
   */
  private async rasterize(
    index: number,
    heavyPages: boolean[] | null,
  ): Promise<{ rgba: ArrayBuffer; width: number; height: number; scale: number }> {
    this.pageStarted.set(index, performance.now());
    const pdf = this.pdfDoc;
    if (!pdf) throw new Error('Converter is not active');

    const page = await pdf.getPage(index + 1);
    const heavy = heavyPages != null && index < heavyPages.length && heavyPages[index];
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(heavy ? RASTER_SCALE : TEXT_RASTER_SCALE, MAX_RASTER_DIM / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });

    // Reuse one canvas across pages; assigning width/height clears it.
    if (!this.rasterCanvas) this.rasterCanvas = document.createElement('canvas');
    const canvas = this.rasterCanvas;
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    if (!this.rasterContext) {
      this.rasterContext = canvas.getContext('2d', { willReadFrequently: true });
    }
    const context = this.rasterContext;
    if (!context) {
      page.cleanup();
      throw new Error('Canvas 2D context is unavailable');
    }
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;

    const { width } = canvas;
    const { height } = canvas;
    const imageData = context.getImageData(0, 0, width, height);
    const rgba = imageData.data.buffer as ArrayBuffer;
    page.cleanup();
    return {
      rgba, width, height, scale,
    };
  }

  /**
   * Custom mode: selected pages run through the AI pipeline one page at a
   * time (fresh per-page converter inside the worker, single-page markdown
   * chunk per round trip); unselected pages take fast pdf.js text
   * extraction. Assembles everything in page order under `## Page N` headers.
   */
  private async runCustomPipeline(
    worker: Worker,
    pdf: PDFDocumentProxy,
    plan: PagePlan,
    ordered: number[],
    handlers: DoclingClientHandlers,
    name: string,
    mode: DoclingMode,
  ): Promise<void> {
    const total = pdf.numPages;
    const heavyMap = plan.pages.map((entry) => entry.heavy);
    const selected = new Set(ordered);
    const blocks: string[] = [];
    let imageCount = 0;
    let imageBefore = 0;
    let imageAfter = 0;
    let imageFormat = '';

    for (let index = 0; index < total; index += 1) {
      if (this.cancelled) return;
      if (selected.has(index)) {
        const raster = await this.rasterize(index, heavyMap);
        if (this.cancelled) return;
        const page = plan.pages[index];
        const needsOcr = page.needsOcr && mode === 'digital';
        const chunkWait = this.waitPageMarkdown(index);
        const request: DoclingRequest = {
          type: 'convertPage',
          index,
          rgba: raster.rgba,
          width: raster.width,
          height: raster.height,
          scale: raster.scale,
          ...(needsOcr ? { ocr: true } : {}),
        };
        worker.postMessage(request, [raster.rgba]);
        const chunk = await chunkWait;
        if (this.cancelled) return;

        if (chunk.images) {
          imageCount += chunk.images.count;
          imageBefore += chunk.images.before;
          imageAfter += chunk.images.after;
          imageFormat = chunk.images.format;
        }

        const pageStarted = this.pageStarted.get(index);
        const delta = pageStarted != null ? performance.now() - pageStarted : 0;
        this.pageDeltas.push(delta);
        if (this.pageDeltas.length > ETA_WINDOW) this.pageDeltas.shift();
        const remaining = ordered.filter((page2) => page2 > index).length;
        const etaSeconds = remaining > 0
          ? ((this.pageDeltas.reduce((sum, d) => sum + d, 0) / this.pageDeltas.length) * remaining) / 1000
          : null;
        const avgSeconds = this.pageDeltas.reduce((sum, d) => sum + d, 0) / this.pageDeltas.length / 1000;
        this.log(`Page ${index + 1}/${total} AI-converted in ${(delta / 1000).toFixed(1)}s — avg ${avgSeconds.toFixed(1)}s/selected page${etaSeconds != null ? `, ~${formatDuration(etaSeconds)} left` : ''}`);
        blocks.push(`## Page ${index + 1}\n\n${chunk.markdown.trim() || '(no text detected)'}`);
        handlers.onPageDone(index, total, etaSeconds);
      } else {
        const { markdown: text } = await pageTextFromPage(pdf, index + 1);
        blocks.push(`## Page ${index + 1}\n\n${text || '(no text detected)'}`);
        this.log(`Page ${index + 1}/${total} — fast text extraction`);
        handlers.onPageDone(index, total, null);
      }
    }

    this.log('Assembling markdown document...');
    const title = name.replace(/\.pdf$/i, '');
    const markdown = `# ${title}\n\n${blocks.join('\n\n')}`;
    if (imageCount > 0) {
      const ratio = imageBefore > 0 ? Math.round((imageAfter / imageBefore) * 100) : 100;
      this.log(`Compacted ${imageCount} embedded image(s): ${formatMB(imageBefore)} → ${formatMB(imageAfter)} of data URIs (${ratio}%, ${imageFormat})`);
    }
    this.log(`Done — ${formatMB(markdown.length)} of markdown in ${formatDuration((performance.now() - this.startedAt) / 1000)}`);
    handlers.onDone(markdown);
  }
}

function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/** Human-readable duration: '42s' or '1m 23s'. */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

/** A visual text line reconstructed from pdf.js items. */
interface ExtractedLine {
  x0: number;
  x1: number;
  y: number;
  size: number;
  text: string;
}

interface TextItemLike {
  str: string;
  transform: number[];
  width?: number;
  height?: number;
}

/** Weighted median (by character count) — the body text size. */
function weightedMedianSize(lines: ExtractedLine[]): number {
  const sorted = [...lines].sort((a, b) => a.size - b.size);
  const total = sorted.reduce((sum, line) => sum + line.text.length, 0);
  if (total === 0) return sorted.length > 0 ? sorted[0].size : 10;
  let acc = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    acc += sorted[i].text.length;
    if (acc >= total / 2) return sorted[i].size;
  }
  return sorted[sorted.length - 1].size;
}

/** Bullet/ordered-list prefix matcher. Returns the marker if the line starts one. */
function listMarker(text: string): 'bullet' | 'ordered' | null {
  if (/^[•●○◦▪■‣·]\s+/.test(text)) return 'bullet';
  if (/^[-–—]\s+/.test(text)) return 'bullet';
  if (/^\(?\d{1,3}[.)]\s+\S/.test(text)) return 'ordered';
  return null;
}

/**
 * Reconstruct visual lines from pdf.js text items: cluster items by Y with a
 * tolerance (sub-pixel offsets no longer split lines), order each line by X,
 * and join runs using the X gap so intra-line spacing is preserved.
 */
function extractLines(content: { items: Array<Record<string, unknown>> }): ExtractedLine[] {
  const items: TextItemLike[] = [];
  content.items.forEach((raw) => {
    const { str } = raw;
    if (typeof str !== 'string' || !str.trim()) return;
    const item = raw as unknown as TextItemLike;
    if (!Array.isArray(item.transform) || item.transform.length < 6) return;
    items.push(item);
  });
  // Reading order: top to bottom.
  items.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
  const lines: ExtractedLine[] = [];
  items.forEach((item) => {
    const [, , , ty, x, y] = item.transform;
    const { str, width: runWidth } = item;
    const size = Math.abs(item.height ?? ty) || 10;
    const width = runWidth ?? str.length * size * 0.5;
    const current = lines[lines.length - 1];
    // Same visual line while Y stays within ~40% of the font size.
    if (current && Math.abs(current.y - y) <= Math.max(2, size * 0.4)) {
      const gap = x - current.x1;
      current.text += (current.text && gap > size * 0.15 ? ' ' : '') + item.str;
      current.x1 = Math.max(current.x1, x + width);
      current.size = Math.max(current.size, size);
    } else {
      lines.push({
        x0: x, x1: x + width, y, size, text: item.str,
      });
    }
  });
  const cleaned = lines
    .map((line) => ({ ...line, text: line.text.replace(/\s+/g, ' ').trim() }))
    .filter((line) => line.text.length > 0);
  return cleaned;
}

/**
 * Smart markdown extraction from one page's text content: font-size based
 * headings, bullet/ordered lists, and paragraph merging via line-gap
 * analysis so the original document structure survives the fast path.
 */
function smartPageMarkdown(content: { items: Array<Record<string, unknown>> }): {
  markdown: string;
  chars: number;
} {
  const lines = extractLines(content);
  if (lines.length === 0) return { markdown: '', chars: 0 };
  const bodySize = weightedMedianSize(lines);
  const blocks: string[] = [];
  let prev: ExtractedLine | null = null;
  let prevType: 'para' | 'heading' | 'list' = 'para';
  let paraText = '';
  const flushPara = () => {
    if (paraText) {
      blocks.push(paraText);
      paraText = '';
    }
  };
  lines.forEach((line) => {
    const gap = prev ? prev.y - line.y : Number.POSITIVE_INFINITY;
    const marker = listMarker(line.text);
    let type: 'para' | 'heading' | 'list';
    let { text } = line;
    if (line.size >= bodySize * 1.55) {
      type = 'heading';
      text = `### ${text}`;
    } else if (line.size >= bodySize * 1.22) {
      type = 'heading';
      text = `#### ${text}`;
    } else if (marker === 'bullet') {
      type = 'list';
      text = `- ${text.replace(/^[•●○◦▪■‣·\-\u2013\u2014]\s+/, '')}`;
    } else if (marker === 'ordered') {
      type = 'list';
      text = text.replace(/^\(/, '').replace(/^\((\d{1,3})[.)]\s+/, '$1. ');
    } else {
      type = 'para';
    }
    // Merge consecutive paragraph lines with normal leading into one block.
    // Typical PDF line spacing is ~1.15-1.25x the font size; distinct
    // paragraphs usually have >=1.5x or a blank line, so 1.35x splits them.
    if (
      type === 'para' && prevType === 'para' && paraText && prev
      && gap < Math.max(prev.size, line.size) * 1.35
    ) {
      paraText += ` ${text}`;
    } else {
      flushPara();
      if (type === 'para') {
        paraText = text;
      } else {
        blocks.push(text);
      }
    }
    prev = line;
    prevType = type;
  });
  flushPara();
  const markdown = blocks.join('\n\n');
  // Plain char count (strip markdown markers) — drives scan detection.
  const chars = markdown.replace(/^[#>\-\s]+/gm, '').replace(/\s+/g, '').length;
  return { markdown, chars };
}

/** Fast per-page markdown extraction (no models). Empty string for scans. */
async function pageTextFromPage(pdf: PDFDocumentProxy, pageNumber: number): Promise<{
  markdown: string;
  chars: number;
}> {
  const page: PDFPageProxy = await pdf.getPage(pageNumber);
  try {
    return smartPageMarkdown(await page.getTextContent());
  } finally {
    page.cleanup();
  }
}

/**
 * Fast text-only extraction with pdf.js: visual lines clustered by Y,
 * headings/lists/paragraphs detected from geometry. No models, works
 * offline, returns the plain character count so the caller can detect
 * scans.
 */
async function extractTextMarkdown(
  pdf: PDFDocumentProxy,
  name: string,
): Promise<{ markdown: string; totalChars: number }> {
  const pages: string[] = [];
  let totalChars = 0;
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const { markdown: pageText, chars } = await pageTextFromPage(pdf, pageNumber);
    totalChars += chars;
    pages.push(`## Page ${pageNumber}\n\n${pageText}`);
  }
  const title = name.replace(/\.pdf$/i, '');
  const markdown = `# ${title}\n\n${pages.join('\n\n')}`;
  return { markdown, totalChars };
}

/**
 * Turn the classification verdict into the interactive page plan: every
 * page gets a reason tag so the UI can explain what the AI pipeline would
 * add. Pages with no text layer are flagged as scans (per-page OCR).
 */
function buildPagePlan(numPages: number, verdict: DocVerdict): PagePlan {
  const pages: PagePlanEntry[] = [];
  for (let i = 0; i < numPages; i += 1) {
    const heavy = verdict.heavyPages[i] ?? false;
    const needsOcr = (verdict.pageChars[i] ?? 0) < MIN_FAST_CHARS;
    const reason: PagePlanEntry['reason'] = needsOcr && !heavy
      ? 'scanned'
      : heavy
        ? (verdict.imageFlags[i] ? 'images' : 'vector-heavy')
        : 'text';
    pages.push({
      index: i, heavy, reason, chars: verdict.pageChars[i] ?? 0, needsOcr,
    });
  }
  return { totalPages: numPages, pages };
}

/**
 * Cheap per-page classification from pdf.js operator lists: pages with
 * raster images or many vector paths need the AI pipeline; pure-text
 * documents take the declarative fast parse (no models). Also collects
 * per-page image flags and text-layer character counts (drive the custom
 * mode plan and the per-page OCR fallback).
 */
async function classifyDoc(pdf: PDFDocumentProxy): Promise<DocVerdict> {
  const imageOps = new Set<number>([
    OPS.paintImageXObject,
    OPS.paintImageXObjectRepeat,
    OPS.paintInlineImageXObject,
    OPS.paintInlineImageXObjectGroup,
    OPS.paintImageMaskXObject,
    OPS.paintImageMaskXObjectGroup,
  ]);
  let imagePages = 0;
  let pathPages = 0;
  const heavyPages: boolean[] = [];
  const imageFlags: boolean[] = [];
  const pageChars: number[] = [];
  const pageMarkdown: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page: PDFPageProxy = await pdf.getPage(pageNumber);
    try {
      const ops = await page.getOperatorList();
      let hasImage = false;
      let pathCount = 0;
      for (let i = 0; i < ops.fnArray.length; i += 1) {
        const fn = ops.fnArray[i];
        if (imageOps.has(fn)) hasImage = true;
        else if (fn === OPS.constructPath) pathCount += 1;
      }
      const { markdown: pageText, chars: pageTextLength } = smartPageMarkdown(await page.getTextContent());
      if (hasImage) imagePages += 1;
      if (pathCount > PATH_OPS_THRESHOLD) pathPages += 1;
      heavyPages.push(hasImage || pathCount > PATH_OPS_THRESHOLD);
      imageFlags.push(hasImage);
      pageChars.push(pageTextLength);
      pageMarkdown.push(pageText);
    } finally {
      page.cleanup();
    }
  }
  logger.debug('[docling] classify', { imagePages, pathPages });
  const mode: 'fast' | 'accurate' = imagePages > 0 || pathPages > 0 ? 'accurate' : 'fast';
  return {
    mode, imagePages, pathPages, heavyPages, imageFlags, pageChars, pageMarkdown,
  };
}
