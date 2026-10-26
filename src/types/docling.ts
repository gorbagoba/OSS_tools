/**
 * Message protocol types for the docling.rs-wasm PDF conversion pipeline.
 * Main thread rasterizes pages with pdf.js and drives the loop; the worker
 * owns the wasm converter plus the ONNX layout/OCR sessions.
 * @category types
 */

/** Pipeline mode picked by the worker after probing the PDF text layer. */
export type DoclingMode = 'digital' | 'scanned';

/**
 * User-selectable conversion strategy. 'auto' classifies the document with
 * pdf.js operator lists and picks fast or accurate per document. 'custom'
 * classifies per page, lets the user pick which pages get the AI pipeline,
 * and interleaves AI output with pdf.js fast text for the rest.
 */
export type ConverterMode = 'auto' | 'custom' | 'fast' | 'accurate';

/** Why the planner flagged a page as needing the AI pipeline. */
export type PageFlagReason = 'images' | 'vector-heavy' | 'text' | 'scanned';

/** One page's entry in the interactive selection plan. */
export interface PagePlanEntry {
  /** Zero-based page index. */
  index: number;
  /** True when the page has images or heavy vector content. */
  heavy: boolean;
  /** Classification reason for the UI. */
  reason: PageFlagReason;
  /** Characters of text-layer content on this page. */
  chars: number;
  /** True when the text layer is too thin — page needs OCR for its text. */
  needsOcr: boolean;
}

/** Per-page classification plan offered to the user in custom mode. */
export interface PagePlan {
  totalPages: number;
  pages: PagePlanEntry[];
}

/* Main -> Worker messages */

/** Start a conversion: worker probes the text layer and loads models. */
export interface DoclingConvertRequest {
  type: 'convert';
  /** PDF file bytes (copied by the caller; never transferred). */
  bytes: ArrayBuffer;
  /** Output document name (drives the markdown title). */
  name: string;
  /**
   * Post-process embedded raster images after assembly: downscale to a
   * bounded edge and re-encode as WebP (JPEG fallback) when that shrinks
   * the data URI. Default true; only accurate-pipeline output carries
   * embedded images.
   */
  compactImages?: boolean;
}

/** Feed one rasterized page (rgba buffer is transferred). */
export interface DoclingAddPageRequest {
  type: 'addPage';
  /** Zero-based page index. */
  index: number;
  /** RGBA pixel buffer (width * height * 4 bytes), transferred. */
  rgba: ArrayBuffer;
  /** Bitmap width in pixels. */
  width: number;
  /** Bitmap height in pixels. */
  height: number;
  /** Pixels per PDF point used when rasterizing (2.0 for pdf.js scale 2). */
  scale: number;
}

/** Assemble all pages and produce the markdown document. */
export interface DoclingFinishRequest {
  type: 'finish';
  name: string;
}

/**
 * Convert ONE page in isolation (custom mode): a fresh per-page converter
 * is constructed from the cached document bytes, the raster is fed in, and
 * the resulting single-page markdown chunk is returned. `ocr` routes the
 * page through the scanned/OCR converter instead of the digital one — used
 * for pages whose text layer is too thin to yield usable text.
 */
export interface DoclingConvertPageRequest {
  type: 'convertPage';
  /** Zero-based page index (also the docling page index in the parsed doc). */
  index: number;
  /** RGBA pixel buffer (transferred). */
  rgba: ArrayBuffer;
  width: number;
  height: number;
  scale: number;
  /** Force the OCR (scanned) converter path for this page. */
  ocr?: boolean;
}

export type DoclingRequest =
  | DoclingConvertRequest
  | DoclingAddPageRequest
  | DoclingFinishRequest
  | DoclingConvertPageRequest
  | DoclingPreloadRequest;

/* Worker -> Main messages */

/** Model/dictionary download progress. */
export interface DoclingModelProgress {
  type: 'model';
  /** Human-readable model label ('layout' | 'ocr' | 'dict'). */
  label: string;
  /** Bytes downloaded so far. */
  got: number;
  /** Total bytes when known, null when the server omits content-length. */
  total: number | null;
}

/** Coarse pipeline stage update ('parsing' | 'models'). */
export interface DoclingStageUpdate {
  type: 'stage';
  stage: string;
}

/** Pipeline mode decision; digital mode carries the parsed page count. */
export interface DoclingModeMessage {
  type: 'mode';
  mode: DoclingMode;
  pageCount: number | null;
}

/** One page finished converting inside the worker. */
export interface DoclingPageDone {
  type: 'pageDone';
  index: number;
}

/** Aggregate result of the image-compaction pass over one document. */
export interface DoclingImageStats {
  /** Number of embedded images actually re-encoded. */
  count: number;
  /** Sum of data-URI string lengths before compaction. */
  before: number;
  /** Sum of data-URI string lengths after compaction. */
  after: number;
  /** MIME type actually used for re-encoding ('image/webp' or 'image/jpeg'). */
  format: string;
}

/** Conversion finished; markdown payload ready. */
export interface DoclingDone {
  type: 'done';
  markdown: string;
  /** Present when compaction ran and re-encoded at least one image. */
  images?: DoclingImageStats;
}

/** One page converted in isolation (custom mode); markdown chunk for it. */
export interface DoclingPageMarkdown {
  type: 'pageMarkdown';
  index: number;
  markdown: string;
  /** Per-page image-compaction stats when compaction re-encoded images. */
  images?: DoclingImageStats;
}

/** Conversion failed; code is a stable identifier when known. */
export interface DoclingError {
  type: 'error';
  message: string;
  code?: string;
}

/** Worker module fully evaluated and onmessage registered. */
export interface DoclingReady {
  type: 'ready';
}

/** Download and cache all AI models ahead of any conversion (preload). */
export interface DoclingPreloadRequest {
  type: 'preload';
}

/** Preload finished; all models are downloaded and cached. */
export interface DoclingModelsCached {
  type: 'modelsCached';
}

export type DoclingResponse =
  | DoclingModelProgress
  | DoclingStageUpdate
  | DoclingModeMessage
  | DoclingPageDone
  | DoclingPageMarkdown
  | DoclingDone
  | DoclingError
  | DoclingReady
  | DoclingModelsCached;
