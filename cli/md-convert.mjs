#!/usr/bin/env node
/**
 * Terminal batch MD converter — docling.rs native bindings (napi addon).
 *
 * Faster than the browser (wasm) path for large PDFs: native ONNX Runtime,
 * no wasm memory cap, models stay warm across the whole batch.
 *
 * Quality-first defaults: strict Markdown, heading hierarchy inferred from
 * bookmarks/numbering/font, alt text, images embedded as data URIs. The
 * pipeline mode auto-selects per document: digital PDFs read the text layer
 * (no models touched), scanned ones get the full layout + OCR pipeline.
 *
 * Usage:
 *   pnpm run md-convert -- <files-or-folders...> [flags]
 *
 *   --fast        force text-layer-only (no models, no OCR — digital PDFs)
 *   --full        force the full pipeline (layout + OCR) even for digital PDFs
 *   --out DIR     write .md files into DIR instead of next to the sources
 *   --lang X      OCR language: "en" (default) or "ch"
 *   --force-ocr   OCR every page even when it has a text layer (lying layers)
 *   --pages A-B   convert only this page window (PDF)
 *   --ocr-scale N OCR render scale px/pt (default 2; 3 = 216 dpi, sharper, slower)
 *   --metadata    add a YAML front-matter block (title/author/date) on top
 *   --page-breaks insert "<!-- page break -->" between pages
 *   --no-images   placeholder images instead of embedded data URIs
 *
 * Models (.models/, ~248 MB) are needed only when a document actually goes
 * through the full pipeline (scanned pages, layout detection).
 */
import { Pipeline, DocumentConverter, checkDependencies } from 'docling.rs'
import { readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve, basename } from 'node:path'
import process from 'node:process'

const SUPPORTED = new Set(['.pdf', '.pptx', '.docx'])

function parseArgs(argv) {
  const files = []
  // Default = full pipeline: layout model recovers headings/tables/reading
  // order that the fast text layer cannot. --auto trades that for speed.
  const opts = { mode: 'full', out: null, lang: null, forceOcr: false, pages: null, ocrScale: null, metadata: false, pageBreaks: false, noImages: false }
  const num = (v, name) => {
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} expects a positive number, got "${v}"`)
    return n
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--fast') opts.mode = 'fast'
    else if (a === '--full') opts.mode = 'full'
    else if (a === '--auto') opts.mode = 'auto'
    else if (a === '--out') opts.out = argv[++i]
    else if (a === '--lang') opts.lang = argv[++i]
    else if (a === '--force-ocr') opts.forceOcr = true
    else if (a === '--pages') opts.pages = argv[++i]
    else if (a === '--ocr-scale') opts.ocrScale = num(argv[++i], '--ocr-scale')
    else if (a === '--metadata') opts.metadata = true
    else if (a === '--page-breaks') opts.pageBreaks = true
    else if (a === '--no-images') opts.noImages = true
    else if (a === '--help' || a === '-h') opts.help = true
    else files.push(a)
  }
  return { files, opts }
}

// Walk a file/dir list to concrete supported files (recursive, deduped, sorted).
function collect(inputs) {
  const seen = new Set()
  const out = []
  const push = (p) => {
    const abs = resolve(p)
    if (SUPPORTED.has(extOf(abs)) && !seen.has(abs)) {
      seen.add(abs)
      out.push(abs)
    }
  }
  for (const input of inputs) {
    const st = statSync(input)
    if (st.isDirectory()) walkDir(resolve(input), push)
    else push(input)
  }
  return out.sort()
}

function walkDir(dir, push) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walkDir(p, push)
    else push(p)
  }
}

function extOf(p) {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i === -1 ? '' : b.slice(i).toLowerCase()
}

function fmtDur(s) {
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

// Live log: one timestamped line per event, appended (never rewritten) so the
// user sees exactly where the batch is in real time, TTY or not.
function stamp() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false })
}

function log(msg) {
  process.stderr.write(`${stamp()} ${msg}\n`)
}

async function main() {
  const { files: inputs, opts } = parseArgs(process.argv.slice(2))
  if (opts.help || inputs.length === 0) {
    process.stdout.write(
      'Usage: pnpm run md-convert -- <files-or-folders...> [flags]\n' +
        '  Converts PDF/PPTX/DOCX to Markdown with docling.rs (native, warm pipeline).\n' +
        '  Default = full pipeline: layout model recovers headings, tables and\n' +
        '  reading order. Speed options trade that for raw speed.\n' +
        '  --fast         text layer only (no models, no headings, fastest)\n' +
        '  --full         force the full pipeline (default)\n' +
        '  --auto         per document: text layer when it carries the doc,\n' +
        '                 full pipeline + OCR when it does not\n' +
        '  --out DIR      write .md files to DIR instead of next to the sources\n' +
        '  --lang X       OCR language "en" (default) or "ch"\n' +
        '  --force-ocr    OCR every page even when it has a text layer\n' +
        '  --pages A-B    convert only this page window (PDF)\n' +
        '  --ocr-scale N  OCR render scale px/pt (default 2; 3 = sharper, slower)\n' +
        '  --metadata     add a YAML front-matter block (title/author/date)\n' +
        '  --page-breaks  insert "<!-- page break -->" between pages\n' +
        '  --no-images    placeholder images instead of embedded data URIs\n',
    )
    return 0
  }

  let files
  try {
    files = collect(inputs)
  } catch {
    process.stderr.write(`Path not found: ${inputs[0]}\n`)
    return 1
  }
  if (files.length === 0) {
    process.stderr.write('No .pdf/.pptx/.docx files found in the given paths.\n')
    return 1
  }

  // mkdirSync recursive returns undefined when the dir already exists —
  // resolve the path explicitly instead of trusting its return value.
  if (opts.out) mkdirSync(resolve(opts.out), { recursive: true })
  const outDir = opts.out ? resolve(opts.out) : null
  // Quality-first converter config shared by both converters:
  // strict      → cleaner Markdown (code-fence languages kept, no run-spacing artifacts)
  // headings    → heading levels inferred from bookmarks → outline numbering → font style
  // alt text    → DOCX/PPTX picture alt text rendered
  // orientation → rotated/tall OCR text lines turned upright (when the optional model exists)
  const deps = checkDependencies()
  const pipelineOpts = {
    strict: true,
    headingHierarchy: true,
    pictureAltText: true,
    ...(deps.ocrTextlineOri ? { ocrTextlineOrientation: true } : {}),
    // 'auto' (default): per document — text layer alone when it carries the
    // document (no model touched), full pipeline + OCR when it does not.
    textLayerOnly: opts.mode === 'fast' ? true : opts.mode === 'full' ? false : 'auto',
    ...(opts.lang ? { ocrLang: opts.lang } : {}),
    ...(opts.forceOcr ? { forceFullPageOcr: true } : {}),
    ...(opts.pages ? { pages: opts.pages } : {}),
    ...(opts.ocrScale ? { ocrScale: opts.ocrScale } : {}),
    ...(opts.metadata ? { metadata: 'frontmatter' } : {}),
  }
  // textLayerOnly is a converter option (#471) — set at construction so the
  // fast path never touches the ML models.
  const pdfPipeline = new Pipeline(pipelineOpts)
  const officeConverter = new DocumentConverter(pipelineOpts)
  const outputOpts = {
    to: 'markdown',
    imageMode: opts.noImages ? 'placeholder' : 'embedded',
    ...(opts.pageBreaks ? { pageBreakPlaceholder: '<!-- page break -->' } : {}),
  }
  const n = String(files.length).padStart(2, ' ')
  const failed = []
  const t0 = Date.now()
  let pagesDone = 0
  const modeLabel = opts.mode === 'fast' ? 'fast (text layer only)' : opts.mode === 'full' ? 'full pipeline (layout + OCR)' : 'auto (text layer, full when scanned)'
  log(`▶ ${files.length} file(s) · ${modeLabel}${outDir ? ` → ${resolve(outDir)}` : ''}`)

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const label = `[${String(i + 1).padStart(n.length)} /${n}] ${basename(file)}`
    const isPdf = extOf(file) === '.pdf'
    const fileStart = Date.now()
    try {
      log(`▶ ${label} · ${isPdf ? 'pdf' : 'office'}`)
      const onProgress = (event) => {
        // docling.rs emits { kind, completed_pages, total_pages } (snake_case);
        // page_no arrives out of order (parallel pages) — use the monotonic counter.
        if (event.kind === 'page_completed') {
          pagesDone += 1
          log(`· ${label} page ${event.completed_pages}/${event.total_pages}`)
        } else if (event.kind === 'enrichment_progress' && event.completed_items === 1) {
          // picture passes (classification/OCR/…) — one line per pass
          log(`· ${label} ${event.step} ${event.total_items} item(s)`)
        } else if (event.kind === 'document_completed' && event.status !== 'success') {
          log(`⚠ ${label} finished with status ${event.status}`)
        }
      }
      // PDFs go through the warm Pipeline (models stay loaded); DOCX/PPTX are
      // declarative (no models) via the reusable DocumentConverter.
      const result = isPdf
        ? await pdfPipeline.convertFileAsync(file, outputOpts, onProgress)
        : await officeConverter.convertFileAsync(file, outputOpts, onProgress)
      const dest = outDir
        ? join(outDir, basename(file, extOf(file)) + '.md')
        : join(dirname(file), basename(file, extOf(file)) + '.md')
      writeFileSync(dest, result.content)
      const secs = (Date.now() - fileStart) / 1000
      const rate = pagesDone > 0 ? `${(pagesDone / ((Date.now() - t0) / 1000)).toFixed(1)} pages/s` : null
      log(`✔ ${label} → ${dest} · ${fmtDur(secs)}${rate ? ` · ${rate}` : ''}`)
    } catch (err) {
      failed.push([basename(file), err instanceof Error ? err.message : String(err)])
      log(`✖ ${label} FAILED: ${failed[failed.length - 1][1]}`)
    }
  }

  const secs = (Date.now() - t0) / 1000
  const rate = pagesDone / secs
  const ok = files.length - failed.length
  log(
    `■ Converted ${ok} of ${files.length} in ${fmtDur(secs)}` +
      (pagesDone > 0 ? ` · ${rate.toFixed(1)} pages/s` : '') +
      (failed.length > 0 ? ` · ${failed.length} failed` : ''),
  )
  for (const [name, msg] of failed) process.stderr.write(`  FAILED ${name}: ${msg}\n`)
  return failed.length > 0 ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  },
)
