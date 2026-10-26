/**
 * Docling conversion worker: owns docling.rs-wasm plus the ONNX runtime
 * sessions (layout detection + OCR). Receives rasterized page bitmaps from
 * the main thread and assembles the final markdown document.
 * @category worker
 */

/// <reference lib="webworker" />

import { DigitalConverter, ScannedConverter } from 'docling.rs-wasm';
import * as ort from 'onnxruntime-web/wasm';
import type {
  DoclingConvertPageRequest,
  DoclingConvertRequest,
  DoclingAddPageRequest,
  DoclingFinishRequest,
  DoclingRequest,
  DoclingResponse,
} from '../types/docling';
import { compactEmbeddedImages } from './compactImages';
import { logger } from '../lib/logger';

/* CORS-enabled hosted models (HTTP cache persists them across reloads). */
const MODEL_LAYOUT_URL = 'https://huggingface.co/pivozavrus/docling-rs-models/resolve/main/layout_heron_int8.onnx';
const MODEL_REC_URL = 'https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv3/en_PP-OCRv3_rec_infer.onnx';
const DICT_URL = 'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/en_dict.txt';

/** Throttle for progress posts (bytes between updates). */
const PROGRESS_STEP = 512 * 1024;

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;

logger.debug('[docling-worker] module top-level: imports done');

type SessionOutput = { data: Float32Array; dims: number[] };

function post(message: DoclingResponse, transfer: Transferable[] = []): void {
  workerScope.postMessage(message, transfer);
}

function errorCodeFor(message: string): string | undefined {
  const normalized = message.toLowerCase();
  if (normalized.includes('password')) return 'PASSWORD_PROTECTED';
  if (normalized.includes('invalid') || normalized.includes('corrupt') || normalized.includes('parse')) {
    return 'INVALID_PDF';
  }
  return undefined;
}

/** Streamed fetch with progress posts; force-cache lets the HTTP cache serve repeats. */
async function fetchWithProgress(url: string, label: string): Promise<ArrayBuffer> {
  const MAX_ATTEMPTS = 3;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetchOnce(url, label);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => {
          setTimeout(resolve, attempt * 1000);
        });
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to download ${label} model`);
}

async function fetchOnce(url: string, label: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) {
    throw new Error(`Failed to download ${label} model (HTTP ${response.status})`);
  }
  const contentLength = response.headers.get('content-length');
  const total = contentLength ? Number.parseInt(contentLength, 10) : null;

  if (!response.body) {
    return response.arrayBuffer();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  let lastPosted = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (got - lastPosted >= PROGRESS_STEP) {
      lastPosted = got;
      post({
        type: 'model', label, got, total,
      });
    }
  }
  post({
    type: 'model', label, got, total,
  });

  const merged = new Uint8Array(got);
  let offset = 0;
  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.length;
  });
  return merged.buffer;
}

async function createSession(buffer: ArrayBuffer): Promise<ort.InferenceSession> {
  return ort.InferenceSession.create(new Uint8Array(buffer), {
    executionProviders: ['wasm'],
    logSeverityLevel: 3,
  });
}

/**
 * Try WebGPU first for the layout model (static [1,3,640,640] input is a
 * good GPU candidate; the int8 QDQ weights dequantize on device or fall
 * back per-node to wasm). Any failure at session creation silently drops
 * to the CPU path — identical behavior, just slower. A watchdog timeout
 * also drops to wasm: on some real-GPU/driver combos ORT's WebGPU adapter
 * request can hang indefinitely instead of rejecting (unobservable in
 * headless test browsers, which have no GPU and fail fast).
 */
const WEBGPU_CREATE_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function createLayoutSession(buffer: ArrayBuffer): Promise<{ session: ort.InferenceSession; ep: string }> {
  try {
    const session = await withTimeout(
      ort.InferenceSession.create(new Uint8Array(buffer), {
        executionProviders: ['webgpu', 'wasm'],
        logSeverityLevel: 3,
      }),
      WEBGPU_CREATE_TIMEOUT_MS,
      'WebGPU layout session creation',
    );
    return { session, ep: 'webgpu' };
  } catch (err) {
    logger.debug('[docling-worker] WebGPU layout session unavailable, using wasm:', String(err));
    return { session: await createSession(buffer), ep: 'wasm' };
  }
}

/** Layout wrapper contract expected by docling.rs: run(data) over a [1,3,640,640] tensor. */
function makeLayoutWrapper(session: ort.InferenceSession): { run(data: Float32Array): Promise<{ logits: SessionOutput; boxes: SessionOutput }> } {
  const inputName = session.inputNames[0];
  return {
    async run(data: Float32Array) {
      const tensor = new ort.Tensor('float32', data, [1, 3, 640, 640]);
      const output = await session.run({ [inputName]: tensor });
      const logits = output['logits'] ?? Object.values(output)[0];
      const boxes = output['pred_boxes'] ?? Object.values(output)[1];
      if (!logits || !boxes) throw new Error('Layout model returned unexpected outputs');
      return {
        logits: { data: logits.data as unknown as Float32Array, dims: [...logits.dims] },
        boxes: { data: boxes.data as unknown as Float32Array, dims: [...boxes.dims] },
      };
    },
  };
}

/** OCR wrapper contract expected by docling.rs: run(n, h, w, data) over a [n,3,h,w] tensor. */
function makeRecWrapper(session: ort.InferenceSession): { run(n: number, h: number, w: number, data: Float32Array): Promise<SessionOutput> } {
  const inputName = session.inputNames[0];
  return {
    async run(n: number, h: number, w: number, data: Float32Array) {
      const tensor = new ort.Tensor('float32', data, [n, 3, h, w]);
      const output = await session.run({ [inputName]: tensor });
      const first = Object.values(output)[0];
      if (!first) throw new Error('OCR model returned no output');
      return { data: first.data as unknown as Float32Array, dims: [...first.dims] };
    },
  };
}

type LayoutWrapper = ReturnType<typeof makeLayoutWrapper>;
type RecWrapper = ReturnType<typeof makeRecWrapper>;

let layout: LayoutWrapper | null = null;
let rec: RecWrapper | null = null;
let dictText: string | null = null;
let digital: DigitalConverter | null = null;
let scanned: ScannedConverter | null = null;

/** Document bytes cached per run for per-page converter construction. */
let runBytes: Uint8Array | null = null;

/** Whether the current run wants the embedded-image compaction pass. */
let compactImages = true;

/**
 * Converter calls must never interleave: add_page suspends at ORT await
 * points, and two concurrent calls on the same wasm converter would corrupt
 * its state. Tasks run strictly one at a time; a failure does not poison
 * the queue (later messages still get a chance to run/report).
 */
let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T> | T): Promise<T> {
  const result = chain.then(task, task) as Promise<T>;
  chain = result.catch(() => undefined);
  return result;
}

/** Load layout + OCR models and the recognition dictionary once per worker. */
async function ensureModels(): Promise<void> {
  if (layout && rec && dictText) return;

  post({ type: 'stage', stage: 'models' });

  const threads = workerScope.crossOriginIsolated
    ? Math.min(workerScope.navigator.hardwareConcurrency || 4, 8)
    : 1;
  ort.env.wasm.numThreads = threads;
  // Self-hosted ORT runtime assets: when ORT is bundled into this worker
  // chunk (prod), its thread-worker URL resolution breaks (aux workers would
  // load OUR chunk instead of the ORT bootstrap and session creation stalls)
  // — point wasmPaths at the copied dist files. In dev, ORT is served as raw
  // dist ESM and resolves its own assets; overriding here would break the
  // dev server (public-dir .mjs?import requests are not transformable).
  if (import.meta.env.PROD) {
    ort.env.wasm.wasmPaths = '/ort/';
  }
  logger.debug('[docling-worker] ORT threads:', threads, '| crossOriginIsolated:', workerScope.crossOriginIsolated);

  const [layoutBuffer, recBuffer, dictBuffer] = await Promise.all([
    fetchWithProgress(MODEL_LAYOUT_URL, 'layout'),
    fetchWithProgress(MODEL_REC_URL, 'ocr'),
    fetchWithProgress(DICT_URL, 'dict'),
  ]);

  const [{ session: layoutSession, ep }, recSession] = await Promise.all([
    createLayoutSession(layoutBuffer),
    createSession(recBuffer),
  ]);
  logger.debug(`[docling-worker] layout EP: ${ep}`);

  layout = makeLayoutWrapper(layoutSession);
  rec = makeRecWrapper(recSession);
  dictText = new TextDecoder().decode(dictBuffer);
}

async function handleConvert(msg: DoclingConvertRequest): Promise<void> {
  logger.debug('[docling-worker] convert received', msg.name);
  // Drop any stale converter left by an aborted earlier run.
  digital = null;
  scanned = null;
  compactImages = msg.compactImages !== false;
  // Keep a copy for per-page converter construction (custom mode): the
  // original ArrayBuffer may be detached by pdf.js on the main thread, so
  // this module-owned view is the only safe source after handleConvert.
  runBytes = new Uint8Array(msg.bytes.slice(0));

  post({ type: 'stage', stage: 'parsing' });

  // Probe the text layer first: a scan throws here and switches the pipeline.
  let probed: DigitalConverter | null = null;
  try {
    probed = new DigitalConverter(new Uint8Array(msg.bytes));
    logger.debug('[docling-worker] text layer probe OK, pages:', probed.page_count());
  } catch (probeErr) {
    logger.debug('[docling-worker] text layer probe failed -> scanned mode', String(probeErr));
    probed = null;
  }

  logger.debug('[docling-worker] loading models...');
  await ensureModels();
  logger.debug('[docling-worker] models ready');

  if (probed && dictText) {
    probed.setDict(dictText);
    digital = probed;
    scanned = null;
    post({ type: 'mode', mode: 'digital', pageCount: probed.page_count() });
  } else if (dictText) {
    digital = null;
    scanned = new ScannedConverter(dictText);
    post({ type: 'mode', mode: 'scanned', pageCount: null });
  } else {
    throw new Error('Failed to load the OCR dictionary');
  }
}

async function handleAddPage(msg: DoclingAddPageRequest): Promise<void> {
  if (!layout || !rec) throw new Error('Models are not loaded');
  const rgba = new Uint8Array(msg.rgba);
  const startedAt = performance.now();
  if (digital) {
    await digital.add_page(msg.index, rgba, msg.width, msg.height, msg.scale, layout, rec);
  } else if (scanned) {
    await scanned.add_page(rgba, msg.width, msg.height, msg.scale, layout, rec);
  } else {
    throw new Error('No active converter');
  }
  logger.debug(`[docling-worker] add_page ${msg.index} (${msg.width}x${msg.height}) took ${(performance.now() - startedAt).toFixed(0)}ms`);
  post({ type: 'pageDone', index: msg.index });
}

/**
 * Convert one page in isolation (custom mode). A fresh converter is built
 * from the cached document bytes so the returned markdown chunk maps to
 * exactly one page — the main thread interleaves these chunks with fast
 * pdf.js text for unselected pages. `ocr: true` routes the page through
 * ScannedConverter: mixed documents with scanned pages would otherwise
 * produce empty text for those pages (layout alone does not OCR page text),
 * so thin-text pages get full-page OCR here.
 */
async function handleConvertPage(msg: DoclingConvertPageRequest): Promise<void> {
  if (!layout || !rec || !dictText || !runBytes) throw new Error('Models are not loaded');
  const rgba = new Uint8Array(msg.rgba);
  const startedAt = performance.now();
  let markdown: string;
  if (msg.ocr || !digital) {
    // Per-page OCR path (scanned page inside a mixed doc, or a fully
    // scanned document): a fresh ScannedConverter OCRs the whole bitmap.
    const conv = new ScannedConverter(dictText);
    await conv.add_page(rgba, msg.width, msg.height, msg.scale, layout, rec);
    markdown = conv.finish(`page-${msg.index + 1}`, 'md', 'embedded');
  } else {
    // Per-page digital path: fresh converter, one add_page, one finish —
    // the chunk maps cleanly to this page index.
    const conv = new DigitalConverter(runBytes);
    conv.setDict(dictText);
    await conv.add_page(msg.index, rgba, msg.width, msg.height, msg.scale, layout, rec);
    markdown = conv.finish(`page-${msg.index + 1}`, 'md', 'embedded');
  }
  logger.debug(`[docling-worker] convertPage ${msg.index} took ${(performance.now() - startedAt).toFixed(0)}ms`);

  if (compactImages) {
    try {
      const { markdown: compacted, images } = await compactEmbeddedImages(markdown);
      if (images && images.count > 0) {
        post({
          type: 'pageMarkdown', index: msg.index, markdown: compacted, images,
        });
        return;
      }
    } catch (err) {
      logger.debug('[docling-worker] per-page image compaction failed, keeping originals:', String(err));
    }
  }
  post({ type: 'pageMarkdown', index: msg.index, markdown });
}

async function handleFinish(msg: DoclingFinishRequest): Promise<void> {
  const converter = digital ?? scanned;
  if (!converter) throw new Error('No active converter');
  let markdown = converter.finish(msg.name, 'md', 'embedded');
  digital = null;
  scanned = null;

  // Compact embedded raster images (downscale + WebP/JPEG re-encode) after
  // assembly — off the main thread, before the payload is transferred.
  if (compactImages) {
    try {
      const { markdown: compacted, images } = await compactEmbeddedImages(markdown);
      if (images && images.count > 0) markdown = compacted;
      if (images) {
        post({ type: 'done', markdown, images });
        return;
      }
    } catch (err) {
      // Compaction is best-effort: fall back to the original markdown.
      logger.debug('[docling-worker] image compaction failed, keeping originals:', String(err));
    }
  }
  post({ type: 'done', markdown });
}

async function handleMessage(msg: DoclingRequest): Promise<void> {
  try {
    switch (msg.type) {
      case 'convert':
        await enqueue(() => handleConvert(msg));
        break;
      case 'addPage':
        await enqueue(() => handleAddPage(msg));
        break;
      case 'convertPage':
        await enqueue(() => handleConvertPage(msg));
        break;
      case 'finish':
        await enqueue(() => handleFinish(msg));
        break;
      case 'preload':
        await enqueue(async () => {
          logger.debug('[docling-worker] preload: downloading + caching models');
          try {
            await ensureModels();
            post({ type: 'modelsCached' });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            post({ type: 'error', message, code: 'MODEL_DOWNLOAD' });
          }
        });
        break;
      default:
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = errorCodeFor(message);
    post({ type: 'error', message, ...(code != null ? { code } : {}) });
  }
}

workerScope.onmessage = (event: MessageEvent<DoclingRequest>) => {
  logger.debug('[docling-worker] message:', event.data.type);
  void handleMessage(event.data);
};

// Signal readiness explicitly: messages posted before the worker module
// (which contains top-level await in the wasm glue) finishes evaluating have
// been observed to never dispatch, so the main thread waits for this.
logger.debug('[docling-worker] onmessage registered, worker ready');
post({ type: 'ready' });
