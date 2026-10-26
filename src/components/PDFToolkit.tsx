/**
 * PDF Toolkit — client-side PDF manipulation (merge, extract, delete,
 * rotate, images → PDF). All processing local: pdf.js renders thumbnails,
 * pdf-lib (dynamic import) performs the document surgery.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  loadPdf, renderThumbs, downloadBlob, pdfBlob,
} from '../lib/pdfTools';
import { useToast } from './ToastProvider';

interface DocEntry {
  id: string;
  name: string;
  pageCount: number;
  thumbs: string[];
  bytes: ArrayBuffer;
}

interface Selection {
  docId: string;
  /** 1-based page number. */
  page: number;
}

const uid = (): string => Math.random().toString(36).slice(2, 10);

export function PDFToolkit(): React.JSX.Element {
  const { show: toast } = useToast();
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [selected, setSelected] = useState<Selection[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState('Drop PDFs here to get started.');
  const [dragOver, setDragOver] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);

  const addPdf = useCallback(
    async (file: File): Promise<void> => {
      setBusy(`Loading ${file.name}…`);
      try {
        const bytes = await file.arrayBuffer();
        const pdf = await loadPdf(bytes);
        const pageCount = pdf.numPages;
        setBusy(`Rendering thumbnails for ${file.name}…`);
        const thumbs = await renderThumbs(pdf, (done, total) => {
          setBusy(`Rendering ${file.name}: page ${done}/${total}…`);
        });
        const entry: DocEntry = {
          id: uid(),
          name: file.name,
          pageCount,
          thumbs,
          bytes,
        };
        setDocs((prev) => [...prev, entry]);
        setStatus(
          `${file.name}: ${pageCount} page${pageCount === 1 ? '' : 's'} loaded.${
            thumbs.length < pageCount
              ? ` (thumbnails capped at first ${thumbs.length})`
              : ''}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus(`Failed to load ${file.name}: ${message}`);
        toast(`Failed to load ${file.name}`, 'error');
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  const handlePdfFiles = useCallback(
    async (files: FileList | null): Promise<void> => {
      if (!files || files.length === 0) return;
      const pdfs = Array.from(files).filter(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
      );
      if (pdfs.length === 0) {
        setStatus('Please choose PDF files.');
        return;
      }
      for (let i = 0; i < pdfs.length; i += 1) {
        // sequential — pdf.js worker stays responsive
        // eslint-disable-next-line no-await-in-loop
        await addPdf(pdfs[i]);
      }
    },
    [addPdf],
  );

  const togglePage = useCallback((docId: string, page: number): void => {
    setSelected((prev) => {
      const idx = prev.findIndex((s) => s.docId === docId && s.page === page);
      if (idx >= 0) return prev.filter((_, i) => i !== idx);
      return [...prev, { docId, page }];
    });
  }, []);

  const removeDoc = useCallback((docId: string): void => {
    setDocs((prev) => prev.filter((d) => d.id !== docId));
    setSelected((prev) => prev.filter((s) => s.docId !== docId));
  }, []);

  /** Lazily loaded pdf-lib + per-doc loaded PDFDocument cache. */
  const mergePages = useCallback(
    async (plan: Array<{ docId: string; page: number }>, outName: string): Promise<void> => {
      if (plan.length === 0) return;
      setBusy('Building PDF…');
      try {
        const { PDFDocument } = await import('pdf-lib');
        const out = await PDFDocument.create();
        const cache = new Map<string, Awaited<ReturnType<typeof PDFDocument.load>>>();
        for (let i = 0; i < plan.length; i += 1) {
          const item = plan[i];
          let src = cache.get(item.docId);
          if (!src) {
            const entry = docs.find((d) => d.id === item.docId);
            if (!entry) throw new Error('Source document missing');
            // eslint-disable-next-line no-await-in-loop
            src = await PDFDocument.load(entry.bytes.slice(0));
            cache.set(item.docId, src);
          }
          // eslint-disable-next-line no-await-in-loop
          const [copied] = await out.copyPages(src, [item.page - 1]);
          out.addPage(copied);
        }
        const bytes = await out.save();
        downloadBlob(pdfBlob(bytes), outName);
        setStatus(`Downloaded ${outName} (${plan.length} page${plan.length === 1 ? '' : 's'}).`);
        toast(`${outName} ready`, 'success');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus(`Merge failed: ${message}`);
        toast('PDF merge failed', 'error');
      } finally {
        setBusy(null);
      }
    },
    [docs, toast],
  );

  /** Delete or rotate the selected pages; one output PDF per affected doc. */
  const modifySelected = useCallback(
    async (mode: 'delete' | 'rotate'): Promise<void> => {
      if (selected.length === 0) return;
      const affected = new Map<string, number[]>(); // docId → pages (1-based)
      selected.forEach((s) => {
        const pages = affected.get(s.docId) ?? [];
        pages.push(s.page);
        affected.set(s.docId, pages);
      });
      setBusy(mode === 'delete' ? 'Deleting pages…' : 'Rotating pages…');
      let count = 0;
      try {
        const { PDFDocument, degrees } = await import('pdf-lib');
        const affectedList = Array.from(affected.entries());
        for (let i = 0; i < affectedList.length; i += 1) {
          const [docId, pages] = affectedList[i];
          const entry = docs.find((d) => d.id === docId);
          if (!entry) throw new Error('Source document missing');
          // eslint-disable-next-line no-await-in-loop
          const src = await PDFDocument.load(entry.bytes.slice(0));
          if (mode === 'delete') {
            pages
              .slice()
              .sort((a, b) => b - a)
              .forEach((p) => src.removePage(p - 1));
          } else {
            pages.forEach((p) => {
              const page = src.getPage(p - 1);
              const current = page.getRotation().angle;
              page.setRotation(degrees((current + 90) % 360));
            });
          }
          // eslint-disable-next-line no-await-in-loop
          const bytes = await src.save();
          const suffix = mode === 'delete' ? 'edited' : 'rotated';
          const outName = `${entry.name.replace(/\.pdf$/i, '')}-${suffix}.pdf`;
          downloadBlob(pdfBlob(bytes), outName);
          count += 1;
        }
        const n = selected.length;
        setSelected([]);
        setStatus(
          mode === 'delete'
            ? `Deleted ${n} page${n === 1 ? '' : 's'} — ${count} file${count === 1 ? '' : 's'} downloaded.`
            : `Rotated ${n} page${n === 1 ? '' : 's'} — ${count} file${count === 1 ? '' : 's'} downloaded.`,
        );
        toast('Done', 'success');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus(`Operation failed: ${message}`);
        toast('PDF operation failed', 'error');
      } finally {
        setBusy(null);
      }
    },
    [docs, selected, toast],
  );

  const imagesToPdf = useCallback(
    async (files: FileList | null): Promise<void> => {
      if (!files || files.length === 0) return;
      const images = Array.from(files).filter((f) => f.type === 'image/png' || f.type === 'image/jpeg');
      if (images.length === 0) {
        setStatus('Images → PDF needs PNG or JPG files.');
        return;
      }
      setBusy('Building PDF from images…');
      try {
        const { PDFDocument } = await import('pdf-lib');
        const out = await PDFDocument.create();
        for (let i = 0; i < images.length; i += 1) {
          const file = images[i];
          // eslint-disable-next-line no-await-in-loop
          const data = await file.arrayBuffer();
          let embedded;
          if (file.type === 'image/png') {
            // eslint-disable-next-line no-await-in-loop
            embedded = await out.embedPng(data);
          } else {
            // eslint-disable-next-line no-await-in-loop
            embedded = await out.embedJpg(data);
          }
          const page = out.addPage([embedded.width, embedded.height]);
          page.drawImage(embedded, {
            x: 0, y: 0, width: embedded.width, height: embedded.height,
          });
        }
        const bytes = await out.save();
        downloadBlob(pdfBlob(bytes), 'images.pdf');
        setStatus(`Downloaded images.pdf (${images.length} page${images.length === 1 ? '' : 's'}).`);
        toast('images.pdf ready', 'success');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus(`Images → PDF failed: ${message}`);
        toast('Images → PDF failed', 'error');
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  const selectionIndex = useCallback(
    (docId: string, page: number): number => selected.findIndex((s) => s.docId === docId && s.page === page),
    [selected],
  );

  return (
    <div className="card">
      <h1 className="text-2xl font-bold mb-2">PDF Toolkit</h1>
      <p className="text-textSecondary mb-4">
        Merge, extract, delete, and rotate pages — all locally in your browser. Click page
        thumbnails to build a selection (in click order), then run an action.
      </p>

      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          void handlePdfFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={imgInputRef}
        type="file"
        accept="image/png,image/jpeg"
        multiple
        className="hidden"
        onChange={(e) => {
          void imagesToPdf(e.target.files);
          e.target.value = '';
        }}
      />

      <div
        role="button"
        tabIndex={0}
        aria-label="Add PDF files"
        onClick={() => pdfInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') pdfInputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handlePdfFiles(e.dataTransfer.files);
        }}
        className={`border-2 border-dashed rounded-lg p-8 mb-4 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-primary bg-primary/10' : 'border-border hover:border-primary'
        }`}
      >
        <p className="font-medium">Drop PDFs here, or click to browse</p>
        <p className="text-sm text-textSecondary mt-1">
          Multiple files supported · pages never leave your device
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          type="button"
          className="px-4 py-2 rounded bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={docs.length < 2 || busy !== null}
          onClick={() => {
            void mergePages(
              docs.flatMap((d) => Array.from({ length: d.pageCount }, (_, i) => ({ docId: d.id, page: i + 1 }))),
              'merged.pdf',
            );
          }}
        >
          Merge all (
          {docs.length}
          {' '}
          docs)
        </button>
        <button
          type="button"
          className="px-4 py-2 rounded bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={selected.length === 0 || busy !== null}
          onClick={() => { void mergePages(selected, 'selection.pdf'); }}
        >
          Extract selected (
          {selected.length}
          )
        </button>
        <button
          type="button"
          className="px-4 py-2 rounded bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={selected.length === 0 || busy !== null}
          onClick={() => { void modifySelected('delete'); }}
        >
          Delete selected
        </button>
        <button
          type="button"
          className="px-4 py-2 rounded bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={selected.length === 0 || busy !== null}
          onClick={() => { void modifySelected('rotate'); }}
        >
          Rotate selected 90°
        </button>
        <button
          type="button"
          className="px-4 py-2 rounded border border-border hover:bg-border disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={busy !== null}
          onClick={() => imgInputRef.current?.click()}
        >
          Images → PDF
        </button>
        <button
          type="button"
          className="px-4 py-2 rounded border border-border hover:bg-border disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={selected.length === 0}
          onClick={() => setSelected([])}
        >
          Clear selection
        </button>
      </div>

      <p className="text-sm text-textSecondary mb-4" role="status" aria-live="polite">
        {busy ?? status}
      </p>

      {docs.map((doc) => (
        <section key={doc.id} className="mb-6" aria-label={doc.name}>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">
              {doc.name}
              <span className="text-textSecondary font-normal">
                {' '}
                ·
                {doc.pageCount}
                {' '}
                pages
              </span>
            </h2>
            <button
              type="button"
              className="text-sm text-textSecondary hover:text-text"
              onClick={() => removeDoc(doc.id)}
              aria-label={`Remove ${doc.name}`}
            >
              Remove
            </button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 gap-2">
            {Array.from({ length: doc.pageCount }, (_, i) => {
              const pageNum = i + 1;
              const thumb = doc.thumbs[i];
              const selIdx = selectionIndex(doc.id, pageNum);
              return (
                <button
                  key={pageNum}
                  type="button"
                  aria-pressed={selIdx >= 0}
                  aria-label={`Page ${pageNum} of ${doc.name}`}
                  onClick={() => togglePage(doc.id, pageNum)}
                  className={`relative rounded border overflow-hidden transition-all ${
                    selIdx >= 0
                      ? 'border-primary ring-2 ring-primary'
                      : 'border-border hover:border-textSecondary'
                  }`}
                >
                  {thumb ? (
                    <>
                      <img src={thumb} alt={`Page ${pageNum}`} className="w-full block bg-white" />
                      <span className="absolute top-0 left-0 px-1 text-[10px] bg-black/60 text-white">
                        {pageNum}
                      </span>
                    </>
                  ) : (
                    <span className="flex items-center justify-center py-5 text-xs font-medium">
                      {pageNum}
                    </span>
                  )}
                  {selIdx >= 0 && (
                    <span className="absolute top-0 right-0 px-1 text-[10px] bg-primary text-white">
                      #
                      {selIdx + 1}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
