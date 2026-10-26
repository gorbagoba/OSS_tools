/**
 * Unified document to Markdown conversion component (PDF + PPTX)
 * @category components
 */

import React, {
  useState, useRef, useEffect, useCallback,
} from 'react';
import { parse } from 'pptxtojson';
import { DoclingClient } from '../lib/doclingClient';
import type { ConverterMode, DoclingMode, PagePlan } from '../types/docling';
import { useA11y } from './A11yProvider';
import { useToast } from './ToastProvider';

type ModelProgressState = {
  label: string;
  got: number;
  total: number | null;
};

type LogLine = { id: number; text: string };

type DocKind = 'pdf' | 'pptx' | 'docx';

const MODEL_LABELS: Record<string, string> = {
  layout: 'Layout detection',
  ocr: 'OCR recognition',
  dict: 'OCR dictionary',
};

const ACCEPTED = '.pdf,.pptx,.docx';

/** Detect the document kind from extension/MIME. */
function detectKind(file: File): DocKind | null {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (
    file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    || name.endsWith('.pptx')
  ) return 'pptx';
  if (
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || name.endsWith('.docx')
  ) return 'docx';
  return null;
}

/** Minimal shape of the pptxtojson parse result we consume. */
type ParsedSlide = {
  elements: Array<{ type: string; src?: string }>;
};

/**
 * Build a markdown string from parsed slides:
 * each slide becomes an H2 section listing its images and tables.
 */
function slidesToMarkdown(slides: ParsedSlide[]): string {
  const lines: string[] = [];

  slides.forEach((slide, index) => {
    lines.push(`## Slide ${index + 1}`);
    lines.push('');

    slide.elements.forEach((el) => {
      if (el.type === 'image') {
        lines.push(`![Slide ${index + 1} Image]`);
        lines.push('');
      } else if (el.type === 'table') {
        lines.push('| Table | Content |');
        lines.push('|-------|---------|');
        lines.push('');
      }
    });

    lines.push('---');
    lines.push('');
  });

  return lines.join('\n').trim();
}

/** One file in a multi-PDF batch conversion. */
type BatchItem = {
  id: number;
  file: File;
  url: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  markdown: string | null;
  error: string | null;
};

/**
 * MD Converter component
 * Converts PDFs (docling.rs-wasm pipeline: layout model + tables + embedded
 * images) and PowerPoint slides (pptxtojson) to Markdown, fully in-browser.
 */
export function ConvertToMarkdown(): React.JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<DocKind | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [currentUnit, setCurrentUnit] = useState<number>(0);
  const [totalUnits, setTotalUnits] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [conversionTime, setConversionTime] = useState<number | null>(null);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [modelProgress, setModelProgress] = useState<ModelProgressState | null>(null);
  const [mode, setMode] = useState<DoclingMode | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [speedMode, setSpeedMode] = useState<ConverterMode>('auto');
  const [compactImages, setCompactImages] = useState(true);
  const [pagePlan, setPagePlan] = useState<PagePlan | null>(null);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [modelsPreloaded, setModelsPreloaded] = useState(false);
  const [preloading, setPreloading] = useState(false);
  const [batchItems, setBatchItems] = useState<BatchItem[] | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const planResolveRef = useRef<((pages: number[] | null) => void) | null>(null);
  const lastConvertRef = useRef<File | null>(null);
  const doclingRef = useRef<DoclingClient | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logBoxRef = useRef<HTMLDivElement>(null);
  const logSeqRef = useRef(0);
  const batchStopRef = useRef(false);
  const batchResolveRef = useRef<((md: string | null) => void) | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const batchItemsRef = useRef<BatchItem[] | null>(null);

  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  useEffect(() => {
    batchItemsRef.current = batchItems;
  }, [batchItems]);

  const { announce } = useA11y();
  const toast = useToast();

  // Keep the live log pinned to the newest line.
  useEffect(() => {
    const box = logBoxRef.current;
    if (box) {
      box.scrollTop = box.scrollHeight;
    }
  }, [logs]);

  /** Append one line to the live log (bounded history). */
  const pushLog = useCallback((line: string) => {
    logSeqRef.current += 1;
    const id = logSeqRef.current;
    const stamp = new Date().toLocaleTimeString([], { hour12: false });
    setLogs((prev) => [...prev.slice(-199), { id, text: `[${stamp}] ${line}` }]);
  }, []);

  // Unmount-only cleanup: abort conversion, stop the batch loop, revoke every
  // object URL (refs track the latest preview/batch state).
  useEffect(() => () => {
    batchStopRef.current = true;
    batchResolveRef.current?.(null);
    doclingRef.current?.abort();
    doclingRef.current = null;
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    (batchItemsRef.current ?? []).forEach((item) => URL.revokeObjectURL(item.url));
  }, []);

  /** Shared conversion-state reset used by convert/process/reset paths. */
  const resetConversionState = useCallback(() => {
    setError(null);
    setWorkerError(null);
    setProgress(0);
    setCurrentUnit(0);
    setTotalUnits(0);
    setConversionTime(null);
    setStage(null);
    setModelProgress(null);
    setMode(null);
    setLogs([]);
    setEtaSeconds(null);
    setPagePlan(null);
    setSelectedPages(new Set());
  }, []);

  /**
   * Convert a PPTX file to Markdown via pptxtojson
   */
  const convertPptx = useCallback(async (selectedFile: File) => {
    const reader = new FileReader();
    reader.onload = async (event) => {
      const arrayBuffer = event.target?.result as ArrayBuffer | null;
      if (!arrayBuffer) {
        setError('Failed to read file');
        setIsProcessing(false);
        return;
      }

      const startTime = performance.now();

      try {
        const result = await parse(arrayBuffer, {});
        const slides: ParsedSlide[] = result.slides as unknown as ParsedSlide[];
        setTotalUnits(slides.length);

        slides.forEach((_slide, index) => {
          setCurrentUnit(index + 1);
          setProgress(Math.round(((index + 1) / slides.length) * 100));
        });

        const md = slidesToMarkdown(slides);
        setMarkdown(md);
        setConversionTime(performance.now() - startTime);
        announce('Slides conversion completed successfully');
      } catch (err) {
        const conversionError = err as Error;
        setError(conversionError.message || 'Failed to convert PPTX file');
        announce(`Slides conversion failed: ${conversionError.message}`);
      } finally {
        setIsProcessing(false);
      }
    };

    reader.onerror = () => {
      setError('Failed to read file');
      setIsProcessing(false);
    };

    reader.readAsArrayBuffer(selectedFile);
  }, [announce]);

  /**
   * Convert a DOCX file to Markdown via mammoth (main thread, dynamic import).
   * Embedded images arrive as data URIs and are optionally re-encoded to WebP.
   */
  const convertDocx = useCallback(async (selectedFile: File, compact: boolean) => {
    const reader = new FileReader();
    reader.onload = async (event) => {
      const arrayBuffer = event.target?.result as ArrayBuffer | null;
      if (!arrayBuffer) {
        setError('Failed to read file');
        setIsProcessing(false);
        return;
      }

      const startTime = performance.now();

      try {
        const mammoth = await import('mammoth');
        // mammoth's .d.ts omits convertToMarkdown (it ships in the runtime API);
        // access it through a narrowed interface.
        const { convertToMarkdown } = mammoth as unknown as {
          convertToMarkdown: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
        };
        const { value } = await convertToMarkdown({ arrayBuffer });
        let md = value;

        if (compact) {
          const { compactEmbeddedImages } = await import('../workers/compactImages');
          const { markdown: compacted, images } = await compactEmbeddedImages(md);
          if (images) {
            const ratio = Math.round((images.after / images.before) * 100);
            md = compacted;
            pushLog(`Compacted ${images.count} embedded image(s) → ${ratio}% (${images.format})`);
          }
        }

        setMarkdown(md);
        setTotalUnits(1);
        setCurrentUnit(1);
        setProgress(100);
        setConversionTime(performance.now() - startTime);
        announce('Document conversion completed successfully');
      } catch (err) {
        const conversionError = err as Error;
        setError(conversionError.message || 'Failed to convert DOCX file');
        announce(`Document conversion failed: ${conversionError.message}`);
      } finally {
        setIsProcessing(false);
      }
    };

    reader.onerror = () => {
      setError('Failed to read file');
      setIsProcessing(false);
    };

    reader.readAsArrayBuffer(selectedFile);
  }, [announce, pushLog]);

  /**
   * Convert a PDF file to Markdown via the docling worker pipeline
   */
  const convertPdf = useCallback((selectedFile: File, mode: ConverterMode, compact: boolean) => new Promise<string | null>((resolve) => {
    // Resolve value feeds the batch loop; single-file path ignores it.
    batchResolveRef.current = resolve;
    let finished = false;
    const finish = (md: string | null) => {
      if (finished) return;
      finished = true;
      if (batchResolveRef.current === resolve) batchResolveRef.current = null;
      resolve(md);
    };
    const client = doclingRef.current ?? new DoclingClient();
    doclingRef.current = client;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const arrayBuffer = event.target?.result as ArrayBuffer | null;
      if (!arrayBuffer) {
        setError('Failed to read file');
        setIsProcessing(false);
        finish(null);
        return;
      }

      const startTime = performance.now();

      await client.convert(
        arrayBuffer,
        selectedFile.name,
        {
          onModelProgress: (label, got, total) => {
            setModelProgress({ label, got, total });
          },
          onStage: (nextStage) => {
            setStage(nextStage);
          },
          onMode: (nextMode, pageCount) => {
            setMode(nextMode);
            setTotalUnits(pageCount);
          },
          onPagePlan: (plan) => new Promise<number[] | null>((planResolve) => {
            setPagePlan(plan);
            setSelectedPages(
              new Set(plan.pages.filter((page) => page.heavy || page.needsOcr).map((page) => page.index)),
            );
            planResolveRef.current = planResolve;
          }),
          onPageDone: (index, total, eta) => {
            setCurrentUnit(index + 1);
            setTotalUnits(total);
            setProgress(Math.min(100, ((index + 1) / total) * 100));
            setEtaSeconds(eta);
          },
          onLog: pushLog,
          onDone: (result) => {
            setMarkdown(result);
            setConversionTime(performance.now() - startTime);
            setIsProcessing(false);
            setStage(null);
            setModelProgress(null);
            setModelsPreloaded(true);
            announce('PDF conversion completed successfully');
            finish(result);
          },
          onError: (message, code) => {
            setError(message);
            setWorkerError(code);
            setIsProcessing(false);
            setStage(null);
            setModelProgress(null);
            announce(`PDF conversion failed: ${message}`);
            finish(null);
          },
        },
        { mode, compactImages: compact },
      );
      // Abort path: convert() swallows the error and fires no handler.
      finish(null);
    };

    reader.onerror = () => {
      setError('Failed to read file');
      setIsProcessing(false);
      finish(null);
    };

    reader.readAsArrayBuffer(selectedFile);
  }), [announce, pushLog]);

  /**
   * Convert a list of PDFs sequentially, keeping per-file results: each item
   * gets its own status, markdown and download. Failed files are marked and
   * skipped, the rest continue.
   */
  const convertBatch = useCallback(async (files: File[]) => {
    batchStopRef.current = false;
    const items: BatchItem[] = files.map((file, i) => ({
      id: i,
      file,
      url: URL.createObjectURL(file),
      status: 'pending',
      markdown: null,
      error: null,
    }));
    setBatchItems(items);
    setBatchRunning(true);
    let done = 0;
    let failed = 0;
    for (let i = 0; i < items.length; i += 1) {
      if (batchStopRef.current) break;
      setBatchItems((prev) => (prev
        ? prev.map((it, j) => (j === i ? { ...it, status: 'processing' as const } : it))
        : prev));
      pushLog(`Batch file ${i + 1} of ${items.length}: ${items[i].file.name}`);
      const md = await convertPdf(items[i].file, speedMode, compactImages);
      if (batchStopRef.current) break;
      if (md) done += 1;
      else failed += 1;
      setBatchItems((prev) => (prev
        ? prev.map((it, j) => (j === i
          ? {
            ...it,
            status: md ? 'done' as const : 'error' as const,
            markdown: md,
            error: md ? null : 'Conversion failed — see the log for details',
          }
          : it))
        : prev));
    }
    setBatchRunning(false);
    if (batchStopRef.current) return;
    if (done > 0) {
      announce(`Batch conversion finished: ${done} of ${items.length} files converted`);
      toast.show(
        `Batch finished: ${done} of ${items.length} converted${failed > 0 ? `, ${failed} failed` : ''}`,
        failed > 0 ? 'info' : 'success',
      );
    } else {
      toast.show('Batch conversion failed — no files converted', 'error');
    }
  }, [announce, toast, pushLog, convertPdf, speedMode, compactImages]);

  /** Download one batch item's markdown (per-file button). */
  const handleBatchDownload = useCallback((item: BatchItem) => {
    if (!item.markdown) return;
    const blob = new Blob([item.markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${item.file.name.replace(/\.pdf$/i, '')}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  /** Download every finished batch item, staggered so browsers keep up. */
  const handleBatchDownloadAll = useCallback(async () => {
    const finished = (batchItems ?? []).filter((item) => item.markdown);
    for (let i = 0; i < finished.length; i += 1) {
      handleBatchDownload(finished[i]);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, 250); });
    }
  }, [batchItems, handleBatchDownload]);

  /**
   * Toggle one page in the custom-mode selection set
   */
  const togglePage = useCallback((index: number) => {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  /**
   * Resolve the paused plan with the confirmed selection (empty = all-fast)
   */
  const handlePlanConfirm = useCallback(() => {
    setPagePlan(null);
    const resolve = planResolveRef.current;
    planResolveRef.current = null;
    resolve?.([...selectedPages].sort((a, b) => a - b));
  }, [selectedPages]);

  /**
   * Cancel the plan: pipeline logs 'Conversion cancelled' and stops
   */
  const handlePlanCancel = useCallback(() => {
    setPagePlan(null);
    setSelectedPages(new Set());
    const resolve = planResolveRef.current;
    planResolveRef.current = null;
    resolve?.(null);
    setIsProcessing(false);
    setStage(null);
    setModelProgress(null);
    announce('Conversion cancelled');
  }, [announce]);

  /**
   * Start conversion for the selected file, dispatching by document kind
   */
  const convertFile = useCallback(async (selectedFile: File, selectedKind: DocKind) => {
    lastConvertRef.current = selectedKind === 'pdf' ? selectedFile : null;
    if (doclingRef.current) {
      doclingRef.current.abort();
      doclingRef.current = null;
    }

    setIsProcessing(true);
    resetConversionState();

    if (selectedKind === 'pdf') {
      await convertPdf(selectedFile, speedMode, compactImages);
    } else if (selectedKind === 'docx') {
      await convertDocx(selectedFile, compactImages);
    } else {
      await convertPptx(selectedFile);
    }
  }, [compactImages, convertDocx, convertPdf, convertPptx, resetConversionState, speedMode]);

  /**
   * Preload AI models (~78MB) via the worker; restarts the last PDF
   * conversion afterwards when one exists (cached models, no re-download).
   */
  const handlePreload = useCallback(() => {
    if (isProcessing || preloading) return;
    setPreloading(true);
    setStage('models');

    const client = doclingRef.current ?? new DoclingClient();
    doclingRef.current = client;

    client
      .preloadModels({
        onModelProgress: (label, got, total) => {
          setModelProgress({ label, got, total });
        },
        onStage: (nextStage) => {
          setStage(nextStage);
        },
        onLog: pushLog,
        onError: (message) => {
          setError(message);
          setPreloading(false);
          setStage(null);
          setModelProgress(null);
          toast.show(`Model download failed: ${message}`, 'error');
          announce(`Model download failed: ${message}`);
        },
      })
      .then(() => {
        setPreloading(false);
        setStage(null);
        setModelProgress(null);
        setModelsPreloaded(true);
        toast.show('Models cached — conversions skip the download', 'success');
        announce('AI models cached');
        const last = lastConvertRef.current;
        if (last) {
          pushLog('Restarting last conversion with cached models');
          convertFile(last, 'pdf');
        }
      })
      .catch((err: unknown) => {
        setPreloading(false);
        setStage(null);
        setModelProgress(null);
        const message = err instanceof Error ? err.message : String(err);
        toast.show(`Preload failed: ${message}`, 'error');
      });
  }, [announce, convertFile, isProcessing, preloading, pushLog, toast]);

  /**
   * Shared pipeline for a newly selected/dropped file: state reset, preview
   * URL, validation, and conversion kickoff.
   */
  const processFile = useCallback((selectedFile: File) => {
    const selectedKind = detectKind(selectedFile);

    // Reset state
    setFile(selectedFile);
    setKind(selectedKind);
    setMarkdown(null);
    resetConversionState();

    // Create preview URL
    setPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return URL.createObjectURL(selectedFile);
    });

    // Validate file type
    if (!selectedKind) {
      setError('Please select a valid PDF, PowerPoint, or Word file (.pdf, .pptx, .docx)');
      return;
    }

    // Start conversion after a short delay to allow UI to update
    setTimeout(() => {
      convertFile(selectedFile, selectedKind);
    }, 50);
  }, [convertFile, resetConversionState]);

  /**
   * Route picked/dropped files: single file → normal flow; multiple files →
   * PDF-only batch conversion (non-PDFs skipped with a notice).
   */
  const handleFiles = useCallback((incoming: File[]) => {
    if (incoming.length === 0) return;
    if (isProcessing || batchRunning) return;
    if (incoming.length === 1) {
      processFile(incoming[0]);
      return;
    }
    const pdfs = incoming.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    const skipped = incoming.length - pdfs.length;
    if (pdfs.length === 0) {
      processFile(incoming[0]); // surfaces the normal unsupported-type error
      return;
    }
    if (skipped > 0) {
      toast.show(`Batch mode supports PDF only — skipping ${skipped} non-PDF file(s)`, 'info');
    }
    if (pdfs.length === 1) {
      processFile(pdfs[0]);
      return;
    }
    setError(null);
    setTimeout(() => {
      void convertBatch(pdfs);
    }, 50);
  }, [isProcessing, batchRunning, processFile, convertBatch, toast]);

  // Clear error when new file is selected
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(Array.from(e.target.files ?? []));
  };

  /**
   * Handle download of markdown file
   */
  const handleDownload = useCallback(() => {
    if (!markdown) return;

    const extension = kind === 'pptx'
      ? /\.pptx$/i
      : kind === 'docx' ? /\.docx$/i : /\.pdf$/i;
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file ? `${file.name.replace(extension, '')}.md` : 'conversion.md';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [markdown, file, kind]);

  /**
   * Handle copy to clipboard
   */
  const handleCopy = useCallback(async () => {
    if (!markdown) return;

    try {
      await navigator.clipboard.writeText(markdown);
      toast.show('Markdown copied to clipboard', 'success');
      announce('Markdown copied to clipboard');
    } catch {
      toast.show('Failed to copy to clipboard', 'error');
      announce('Failed to copy to clipboard');
    }
  }, [markdown, announce, toast]);

  /**
   * Handle reset
   */
  const handleReset = useCallback(() => {
    // Stop a running batch loop and un-hang its pending convertPdf promise.
    batchStopRef.current = true;
    batchResolveRef.current?.(null);
    batchResolveRef.current = null;
    (batchItemsRef.current ?? []).forEach((item) => URL.revokeObjectURL(item.url));
    setBatchItems(null);
    setBatchRunning(false);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setFile(null);
    setKind(null);
    setPreviewUrl(null);
    setMarkdown(null);
    resetConversionState();

    if (doclingRef.current) {
      doclingRef.current.abort();
      doclingRef.current = null;
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [previewUrl, resetConversionState]);

  /**
   * Handle drop event — feed the dropped file through the same pipeline as
   * the file input (a detached synthetic input change is invisible to React).
   */
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    handleFiles(Array.from(e.dataTransfer.files ?? []));
  }, [handleFiles]);

  /**
   * Handle drag over
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const progressLabel = kind === 'pdf'
    ? (totalUnits > 0
      ? `Converting page ${currentUnit} of ${totalUnits}...`
      : stage === 'parsing'
        ? (speedMode === 'fast' && mode === null
          ? 'Parsing PDF text layer (fast mode, no AI models)...'
          : (speedMode === 'auto' || speedMode === 'custom') && mode === null
            ? 'Analyzing PDF structure (picking fast or AI pipeline)...'
            : 'Parsing PDF text layer...')
        : 'Preparing conversion...')
    : kind === 'docx'
      ? 'Converting DOCX document...'
      : `Converting slide ${currentUnit} of ${totalUnits}...`;

  // Batch progress: current file index + overall ETA (current file's ETA plus
  // remaining files estimated from the last completed file's duration).
  const batchCurrent = batchItems
    ? batchItems.findIndex((item) => item.status === 'processing')
    : -1;
  const batchEta = batchItems && batchCurrent >= 0 && etaSeconds != null
    ? etaSeconds
      + (batchItems.length - batchCurrent - 1) * (conversionTime != null ? conversionTime / 1000 : 0)
    : null;

  return (
    <div className="card">
      <h1 className="text-2xl font-bold mb-4">MD Converter</h1>
      <p className="text-textSecondary mb-4">
        Convert PDF documents, PowerPoint slides, and Word documents to Markdown with
        layout-aware structure: headings, tables, and embedded images. All processing
        happens locally in your browser.
      </p>

      {/* Speed selector (PDF only — DOCX/PPTX conversion is always instant) */}
      <div className="mb-4 p-3 rounded-xl border border-border bg-input/40" role="radiogroup" aria-label="Conversion mode">
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            role="radio"
            aria-checked={speedMode === 'auto'}
            onClick={() => setSpeedMode('auto')}
            disabled={isProcessing}
            className={`flex-1 text-left px-4 py-2.5 rounded-lg border transition-colors disabled:opacity-60 ${
              speedMode === 'auto'
                ? 'border-primary bg-primary/10'
                : 'border-border bg-input hover:border-primary/60'
            }`}
          >
            <p className="text-sm font-medium">Auto</p>
            <p className="text-xs text-textSecondary">
              Scans the document first: text-only PDFs parse near-instantly; pages with
              images or diagrams use the AI pipeline.
            </p>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={speedMode === 'fast'}
            onClick={() => setSpeedMode('fast')}
            disabled={isProcessing}
            className={`flex-1 text-left px-4 py-2.5 rounded-lg border transition-colors disabled:opacity-60 ${
              speedMode === 'fast'
                ? 'border-primary bg-primary/10'
                : 'border-border bg-input hover:border-primary/60'
            }`}
          >
            <p className="text-sm font-medium">Fast</p>
            <p className="text-xs text-textSecondary">
              Text extracted straight from the PDF with pdf.js. No AI models, no images — near-instant.
            </p>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={speedMode === 'accurate'}
            onClick={() => setSpeedMode('accurate')}
            disabled={isProcessing}
            className={`flex-1 text-left px-4 py-2.5 rounded-lg border transition-colors disabled:opacity-60 ${
              speedMode === 'accurate'
                ? 'border-primary bg-primary/10'
                : 'border-border bg-input hover:border-primary/60'
            }`}
          >
            <p className="text-sm font-medium">Accurate</p>
            <p className="text-xs text-textSecondary">
              AI layout detection: headings, tables, picture OCR. Slower (~1-2s/page),
              downloads ~78MB of models once.
            </p>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={speedMode === 'custom'}
            onClick={() => setSpeedMode('custom')}
            disabled={isProcessing}
            className={`flex-1 text-left px-4 py-2.5 rounded-lg border transition-colors disabled:opacity-60 ${
              speedMode === 'custom'
                ? 'border-primary bg-primary/10'
                : 'border-border bg-input hover:border-primary/60'
            }`}
          >
            <p className="text-sm font-medium">Custom</p>
            <p className="text-xs text-textSecondary">
              Scans first, then you pick which pages get the AI treatment — the rest use
              fast text extraction.
            </p>
          </button>
        </div>

        {/* Custom-mode page selector (shown while the plan is paused) */}
        {pagePlan && (
          <div className="mt-3 p-3 rounded-lg border border-primary/50 bg-primary/5">
            <p className="text-sm font-medium mb-1">Select pages for AI processing</p>
            <p className="text-xs text-textSecondary mb-2">
              {pagePlan.pages.filter((page) => page.heavy || page.needsOcr).length}
              {' '}
              of
              {' '}
              {pagePlan.totalPages}
              {' '}
              page(s) detected with images, tables, or scans
              (pre-selected). Unselected pages use fast text extraction.
            </p>
            <div className="flex flex-wrap gap-2 mb-3 max-h-40 overflow-y-auto">
              {pagePlan.pages.map((page) => (
                <label
                  key={page.index}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-xs cursor-pointer select-none transition-colors ${
                    selectedPages.has(page.index)
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-input'
                  }`}
                >
                  <input
                    type="checkbox"
                    aria-label={`Page ${page.index + 1} — ${page.reason}`}
                    checked={selectedPages.has(page.index)}
                    onChange={() => togglePage(page.index)}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  <span className="font-medium">
                    Page
                    {' '}
                    {page.index + 1}
                  </span>
                  <span className="text-textSecondary">
                    {page.reason === 'vector-heavy' ? 'tables/diagrams' : page.reason}
                  </span>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedPages(new Set(pagePlan.pages.map((page) => page.index)))}
                className="px-3 py-1.5 text-xs rounded-lg border border-border bg-input hover:border-primary/60 transition-colors"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => setSelectedPages(new Set())}
                className="px-3 py-1.5 text-xs rounded-lg border border-border bg-input hover:border-primary/60 transition-colors"
              >
                Select none
              </button>
              <button
                type="button"
                onClick={handlePlanConfirm}
                className="px-3 py-1.5 text-xs rounded-lg bg-primary text-white hover:opacity-90 transition-opacity"
              >
                Confirm and convert
              </button>
              <button
                type="button"
                onClick={handlePlanCancel}
                className="px-3 py-1.5 text-xs rounded-lg border border-border bg-input hover:border-red-500/60 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Image compaction toggle (PDF only) */}
        <label className="mt-3 flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            aria-label="Compact embedded images"
            checked={compactImages}
            onChange={(event) => setCompactImages(event.target.checked)}
            disabled={isProcessing}
            className="h-4 w-4 accent-primary"
          />
          <span className="text-sm text-textSecondary">
            Compact embedded images — downscale and re-encode as WebP for much
            smaller markdown files
          </span>
        </label>

        {/* Model preload / restart (PDF only, idle only) */}
        {kind !== 'pptx' && kind !== 'docx' && !isProcessing && (!modelsPreloaded || lastConvertRef.current) && (
          <button
            type="button"
            onClick={handlePreload}
            disabled={preloading}
            className="mt-3 px-3 py-1.5 text-xs rounded-lg border border-border bg-input hover:border-primary/60 transition-colors disabled:opacity-60"
          >
            {preloading
              ? 'Preloading models…'
              : lastConvertRef.current
                ? 'Preload models & restart conversion'
                : 'Preload AI models (~78MB, one-time)'}
          </button>
        )}
      </div>

      {/* File Upload Area — hidden while a batch is confirmed (results show below) */}
      {!batchItems && (
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
          error ? 'border-red-500 bg-red-500/5' : 'border-border hover:border-primary'
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          multiple
          className="hidden"
          onChange={handleFileChange}
          disabled={isProcessing || batchRunning}
          aria-label="Select PDF, PowerPoint, or Word file for conversion"
        />

        {!previewUrl ? (
          <div className="space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-primary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 2.586L7 7.586V19a2 2 0 002 2z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 9h6v6H9z"
                />
              </svg>
            </div>
            <div>
              <p className="text-textSecondary mb-2">
                Drag and drop your PDF or PPTX file here, or click to browse
              </p>
              <p className="text-xs text-textSecondary/70">
                Supported: .pdf, .pptx — PDFs download AI models on first run (~80MB, cached afterwards).
                Select or drop multiple PDFs for batch conversion.
              </p>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing || batchRunning}
              className="px-6 py-2.5 rounded-lg bg-primary text-black font-medium hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Browse Files
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 pb-8">
            {/* Full document viewer - A4 size */}
            <div className="bg-gray-800 rounded-xl overflow-hidden border border-border flex flex-col min-h-[125vh]">
              <div className="px-4 py-2 border-b border-border/20 bg-gray-800/50 flex-shrink-0">
                <p className="text-xs text-textSecondary">
                  {kind === 'pptx'
                    ? 'PowerPoint Preview (A4 size)'
                    : kind === 'docx'
                      ? 'Word Document'
                      : 'PDF Preview (A4 size)'}
                </p>
              </div>
              <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-gray-900/30">
                {kind === 'pptx' ? (
                  <embed
                    src={previewUrl}
                    type="application/vnd.openxmlformats-officedocument.presentationml.presentation"
                    className="w-full h-full max-w-[210mm] max-h-[297mm] max-w-[794px] max-h-[1123px] aspect-[210/297]"
                    aria-label="PowerPoint preview"
                  />
                ) : kind === 'docx' ? (
                  <div className="text-textSecondary text-sm max-w-lg text-center">
                    <p className="font-semibold mb-2">{file?.name}</p>
                    <p>DOCX preview is not supported in-browser — use the markdown output below.</p>
                  </div>
                ) : (
                  <embed
                    src={previewUrl}
                    type="application/pdf"
                    className="w-full h-full min-h-[110vh]"
                    aria-label="PDF preview"
                  />
                )}
              </div>
            </div>

            {/* File info and controls - At the bottom */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-input/50 rounded-xl border border-border">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-textSecondary mb-1">File</p>
                <h3 className="text-sm font-medium text-text truncate" title={file?.name}>
                  {file?.name}
                </h3>
                <p className="text-xs text-textSecondary">
                  {(file?.size || 0) / 1024}
                  {' '}
                  KB
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-5 py-2.5 rounded-lg border border-border bg-input hover:border-primary transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Reset
                </button>
                {markdown && !isProcessing && (
                  <>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="px-5 py-2.5 rounded-lg border border-border bg-input hover:border-primary transition-colors flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                      </svg>
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={handleDownload}
                      className="px-5 py-2.5 rounded-lg border border-border bg-input hover:border-primary transition-colors flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download
                    </button>
                  </>
                )}
              </div>
            </div>

            {isProcessing && (
              <div className="space-y-2">
                {modelProgress ? (
                  <>
                    <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full bg-gradient-to-r from-blue-500 to-purple-500 ${
                          modelProgress.total == null ? 'w-full animate-pulse' : 'transition-all duration-200'
                        }`}
                        style={
                          modelProgress.total != null
                            ? { width: `${Math.min(100, (modelProgress.got / modelProgress.total) * 100)}%` }
                            : undefined
                        }
                      />
                    </div>
                    <div className="flex justify-between text-xs text-textSecondary">
                      <span className="flex items-center gap-2">
                        <Spinner />
                        Downloading
                        {' '}
                        {MODEL_LABELS[modelProgress.label] || modelProgress.label}
                        {' '}
                        model (
                        {formatMB(modelProgress.got)}
                        {modelProgress.total != null ? ` / ${formatMB(modelProgress.total)}` : ''}
                        {' '}
                        MB) — first run only, cached afterwards
                      </span>
                      {modelProgress.total != null && (
                        <span>
                          {Math.min(100, (modelProgress.got / modelProgress.total) * 100).toFixed(0)}
                          %
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full bg-gradient-to-r from-green-500 to-blue-500 transition-all duration-200 ${
                          totalUnits === 0 ? 'w-full animate-pulse' : ''
                        }`}
                        style={totalUnits > 0 ? { width: `${progress}%` } : undefined}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-textSecondary">
                      <span className="flex items-center gap-2">
                        <Spinner />
                        {progressLabel}
                      </span>
                      <span className="flex items-center gap-3">
                        {etaSeconds != null && (
                          <span className="font-medium text-text">
                            ~
                            {formatEta(etaSeconds)}
                            {' '}
                            left
                          </span>
                        )}
                        <span>
                          {progress.toFixed(0)}
                          %
                        </span>
                      </span>
                    </div>
                    {mode === 'scanned' && (
                      <p className="text-xs text-textSecondary/70">
                        Scanned document detected — running OCR (slower, but fully local).
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Live conversion log */}
            {logs.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium text-textSecondary flex items-center gap-2">
                    {isProcessing && <Spinner />}
                    Live log
                  </p>
                  <p className="text-xs text-textSecondary/60">
                    {logs.length}
                    {' '}
                    events
                  </p>
                </div>
                <div
                  ref={logBoxRef}
                  className="h-40 overflow-y-auto rounded-lg bg-gray-900 border border-border p-3 font-mono text-xs text-gray-300 custom-scrollbar"
                  aria-label="Conversion log"
                >
                  {logs.map((entry) => (
                    <div key={entry.id} className="whitespace-pre-wrap break-all">
                      {entry.text}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* Batch results: per-file preview, status, markdown and download */}
      {batchItems && (
        <div className="mt-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">
              Batch —
              {' '}
              {batchItems.length}
              {' '}
              file(s)
              {!batchRunning && ` — ${batchItems.filter((item) => item.status === 'done').length} converted`}
            </h2>
            <div className="flex gap-3">
              {batchItems.some((item) => item.markdown) && (
                <button
                  type="button"
                  onClick={() => { void handleBatchDownloadAll(); }}
                  disabled={batchRunning}
                  className="px-5 py-2.5 rounded-lg bg-primary text-black font-medium hover:bg-green-600 disabled:opacity-50 transition-colors"
                >
                  Download all (
                  {batchItems.filter((item) => item.markdown).length}
                  )
                </button>
              )}
              <button
                type="button"
                onClick={handleReset}
                className="px-5 py-2.5 rounded-lg border border-border bg-input hover:border-primary transition-colors"
              >
                Reset
              </button>
            </div>
          </div>
          {batchCurrent >= 0 && (
            <div className="space-y-2">
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full bg-gradient-to-r from-green-500 to-blue-500 transition-all duration-200 ${
                    totalUnits === 0 ? 'w-full animate-pulse' : ''
                  }`}
                  style={totalUnits > 0 ? { width: `${progress}%` } : undefined}
                />
              </div>
              <div className="flex justify-between text-xs text-textSecondary">
                <span className="flex items-center gap-2">
                  <Spinner />
                  File
                  {' '}
                  {batchCurrent + 1}
                  {' of '}
                  {batchItems.length}
                  {stage ? ` — ${stage}` : ''}
                </span>
                <span className="flex items-center gap-3">
                  {batchEta != null && (
                    <span className="font-medium text-text">
                      ~
                      {formatEta(batchEta)}
                      {' '}
                      left
                    </span>
                  )}
                  <span>
                    {progress.toFixed(0)}
                    %
                  </span>
                </span>
              </div>
            </div>
          )}
          {logs.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-textSecondary flex items-center gap-2">
                  {batchRunning && <Spinner />}
                  Live log
                </p>
                <p className="text-xs text-textSecondary/60">
                  {logs.length}
                  {' '}
                  events
                </p>
              </div>
              <div
                ref={logBoxRef}
                className="h-40 overflow-y-auto rounded-lg bg-gray-900 border border-border p-3 font-mono text-xs text-gray-300 custom-scrollbar"
                aria-label="Conversion log"
              >
                {logs.map((entry) => (
                  <div key={entry.id} className="whitespace-pre-wrap break-all">
                    {entry.text}
                  </div>
                ))}
              </div>
            </div>
          )}
          {batchItems.map((item) => (
            <div key={item.id} className="bg-gray-800 rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-medium text-text truncate" title={item.file.name}>
                    {item.file.name}
                  </h3>
                  <p className="text-xs text-textSecondary" role="status">
                    {item.status === 'pending' && 'Waiting…'}
                    {item.status === 'processing' && 'Converting…'}
                    {item.status === 'done' && 'Converted'}
                    {item.status === 'error' && 'Failed'}
                  </p>
                </div>
                {item.markdown && (
                  <button
                    type="button"
                    onClick={() => handleBatchDownload(item)}
                    className="px-4 py-2 rounded-lg border border-border bg-input hover:border-primary transition-colors text-sm"
                  >
                    Download
                  </button>
                )}
              </div>
              {item.error && <p className="text-xs text-red-400">{item.error}</p>}
              <embed
                src={item.url}
                type="application/pdf"
                className="w-full h-[40vh]"
                aria-label={`PDF preview: ${item.file.name}`}
              />
              {item.markdown && (
                <textarea
                  readOnly
                  rows={6}
                  value={item.markdown}
                  aria-label={`Markdown preview for ${item.file.name}`}
                  className="w-full text-xs font-mono bg-gray-900 border border-border rounded-lg p-3 text-textSecondary custom-scrollbar"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Markdown Preview — batch mode has per-file previews instead */}
      {markdown && !batchItems && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium">Markdown Preview</h2>
            {conversionTime && (
              <span className="text-xs text-textSecondary">
                Completed in
                {' '}
                {(conversionTime / 1000).toFixed(2)}
                s
              </span>
            )}
          </div>
          <div className="bg-input border border-border rounded-xl p-4 max-h-[500px] overflow-y-auto custom-scrollbar">
            <div className="prose prose-invert max-w-none">
              <textarea
                className="w-full min-h-[300px] p-4 bg-transparent text-text font-mono text-sm outline-none resize-vertical"
                value={markdown}
                readOnly
                aria-label="Markdown preview"
              />
            </div>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h3 className="text-sm font-medium text-red-400 mb-1">Conversion Error</h3>
              <p className="text-sm text-textSecondary">{error}</p>
              {workerError === 'PASSWORD_PROTECTED' && (
                <p className="text-xs text-textSecondary/70 mt-2">
                  Note: This PDF appears to be password-protected. Please remove the password
                  and try again.
                </p>
              )}
              {workerError === 'INVALID_PDF' && (
                <p className="text-xs text-textSecondary/70 mt-2">
                  Note: The file does not appear to be a valid PDF document.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-input border border-border rounded-xl p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <span className="text-primary font-bold">1</span>
            </div>
            <h3 className="text-sm font-medium">Upload File</h3>
          </div>
          <p className="text-xs text-textSecondary">
            Drag and drop or click to select a PDF, PowerPoint, or Word file. Maximum 50MB recommended.
          </p>
        </div>
        <div className="bg-input border border-border rounded-xl p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <span className="text-primary font-bold">2</span>
            </div>
            <h3 className="text-sm font-medium">Automatic Conversion</h3>
          </div>
          <p className="text-xs text-textSecondary">
            PDFs get layout-aware structure detection (headings, tables, images) with OCR for
            scanned pages; slides are extracted with pptxtojson; Word documents are converted
            inline with mammoth, including embedded images. PDFs download models on first run.
          </p>
        </div>
        <div className="bg-input border border-border rounded-xl p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <span className="text-primary font-bold">3</span>
            </div>
            <h3 className="text-sm font-medium">Export Results</h3>
          </div>
          <p className="text-xs text-textSecondary">
            Copy to clipboard or download as .md file — PDF images are embedded as data URIs.
          </p>
        </div>
      </div>
    </div>
  );
}

function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/** Human-friendly remaining-time estimate. */
function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

/** Small inline activity spinner. */
function Spinner(): React.JSX.Element {
  return (
    <svg className="w-3.5 h-3.5 animate-spin text-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
