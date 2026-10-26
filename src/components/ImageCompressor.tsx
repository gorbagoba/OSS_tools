/**
 * Image Compressor — client-side re-encoding with quality control.
 * WebP/JPEG/PNG use the native canvas encoder; AVIF uses @jsquash/avif
 * (WASM, dynamically imported). Optional max-width downscaling.
 */
import React, { useCallback, useRef, useState } from 'react';
import { downloadBlob, formatBytes } from '../lib/pdfTools';
import { useToast } from './ToastProvider';

type OutFormat = 'image/webp' | 'image/jpeg' | 'image/png' | 'image/avif';

interface Item {
  id: string;
  file: File;
  status: 'pending' | 'processing' | 'done' | 'error';
  result?: Blob;
  outName?: string;
  error?: string;
}

const uid = (): string => Math.random().toString(36).slice(2, 10);

const FORMAT_LABEL: Record<OutFormat, string> = {
  'image/webp': 'WebP',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/avif': 'AVIF',
};

const EXT: Record<OutFormat, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/avif': 'avif',
};

/** canvas.toBlob as a promise. */
function canvasToBlob(canvas: HTMLCanvasElement, type: OutFormat, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Encoding produced no data'))),
      type,
      type === 'image/png' ? undefined : quality / 100,
    );
  });
}

export function ImageCompressor(): React.JSX.Element {
  const { show: toast } = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [format, setFormat] = useState<OutFormat>('image/webp');
  const [quality, setQuality] = useState(80);
  const [maxWidth, setMaxWidth] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const runningRef = useRef(false);

  const updateItem = useCallback((id: string, patch: Partial<Item>): void => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const compressOne = useCallback(
    async (item: Item, fmt: OutFormat, q: number, maxW: number | null): Promise<boolean> => {
      updateItem(item.id, { status: 'processing' });
      try {
        const bitmap = await createImageBitmap(item.file);
        const scale = maxW && bitmap.width > maxW ? maxW / bitmap.width : 1;
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close();

        let blob: Blob;
        if (fmt === 'image/avif') {
          const imageData = ctx.getImageData(0, 0, w, h);
          const avif = await import('@jsquash/avif/encode');
          const buf = await avif.default(imageData, { quality: Math.round(q) });
          blob = new Blob([buf], { type: 'image/avif' });
        } else {
          blob = await canvasToBlob(canvas, fmt, q);
        }
        if (blob.size >= item.file.size && scale === 1) {
          // re-encoding gained nothing; flag it instead of serving a bigger file
          updateItem(item.id, {
            status: 'done',
            result: blob,
            outName: `${item.file.name.replace(/\.[^.]+$/, '')}.${EXT[fmt]}`,
            error: 'Output is not smaller than the original — try lower quality or a resize.',
          });
          return true;
        }
        updateItem(item.id, {
          status: 'done',
          result: blob,
          outName: `${item.file.name.replace(/\.[^.]+$/, '')}.${EXT[fmt]}`,
        });
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        updateItem(item.id, { status: 'error', error: message });
        return false;
      }
    },
    [updateItem],
  );

  const processAll = useCallback(
    async (files: File[]): Promise<void> => {
      if (runningRef.current) {
        toast('Wait for the current batch to finish', 'info');
        return;
      }
      runningRef.current = true;
      const fresh: Item[] = files.map((file) => ({ id: uid(), file, status: 'pending' }));
      setItems(fresh);
      setRunning(true);
      const parsed = Number.parseInt(maxWidth, 10);
      const maxW = maxWidth.trim() === '' || Number.isNaN(parsed) ? null : parsed;
      let done = 0;
      for (let i = 0; i < fresh.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        if (await compressOne(fresh[i], format, quality, maxW)) done += 1;
      }
      runningRef.current = false;
      setRunning(false);
      toast(`Compressed ${done} of ${fresh.length} image${fresh.length === 1 ? '' : 's'}`, 'success');
    },
    [compressOne, format, quality, maxWidth, toast],
  );

  const handleFiles = useCallback(
    (files: FileList | null): void => {
      if (!files || files.length === 0) return;
      const images = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (images.length === 0) {
        toast('No image files found', 'error');
        return;
      }
      void processAll(images);
    },
    [processAll, toast],
  );

  const downloadAll = useCallback((): void => {
    items.forEach((item, i) => {
      if (!item.result || !item.outName) return;
      window.setTimeout(() => downloadBlob(item.result as Blob, item.outName as string), i * 250);
    });
  }, [items]);

  const doneCount = items.filter((i) => i.status === 'done').length;

  return (
    <div className="card">
      <h1 className="text-2xl font-bold mb-2">Image Compressor</h1>
      <p className="text-textSecondary mb-4">
        Re-encode images locally — smaller files, no uploads. Pick a format, tune quality,
        optionally cap the width.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <div className="flex flex-wrap items-end gap-4 mb-4">
        <div>
          <label htmlFor="ic-format" className="block text-sm mb-1">
            Output format
          </label>
          <select
            id="ic-format"
            value={format}
            onChange={(e) => setFormat(e.target.value as OutFormat)}
            className="px-3 py-2 rounded border border-border bg-input"
          >
            {(Object.keys(FORMAT_LABEL) as OutFormat[]).map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABEL[f]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ic-quality" className="block text-sm mb-1">
            Quality:
            {' '}
            {quality}
          </label>
          <input
            id="ic-quality"
            type="range"
            min={10}
            max={100}
            value={quality}
            disabled={format === 'image/png'}
            onChange={(e) => setQuality(Number(e.target.value))}
            className="w-40"
          />
        </div>
        <div>
          <label htmlFor="ic-maxwidth" className="block text-sm mb-1">
            Max width (px)
          </label>
          <input
            id="ic-maxwidth"
            type="number"
            min={16}
            placeholder="original"
            value={maxWidth}
            onChange={(e) => setMaxWidth(e.target.value)}
            className="w-28 px-3 py-2 rounded border border-border bg-input"
          />
        </div>
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-label="Add images"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`border-2 border-dashed rounded-lg p-8 mb-4 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-primary bg-primary/10' : 'border-border hover:border-primary'
        }`}
      >
        <p className="font-medium">Drop images here, or click to browse</p>
        <p className="text-sm text-textSecondary mt-1">
          Batch supported · files never leave your device
        </p>
      </div>

      {items.length > 0 && (
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            className="px-4 py-2 rounded bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
            disabled={doneCount === 0 || running}
            onClick={downloadAll}
          >
            Download all (
            {doneCount}
            )
          </button>
          <span className="text-sm text-textSecondary" role="status" aria-live="polite">
            {running
              ? 'Processing…'
              : `${doneCount}/${items.length} compressed`}
          </span>
        </div>
      )}

      <ul className="space-y-2">
        {items.map((item) => {
          const savings = item.result != null
            ? Math.round((1 - item.result.size / item.file.size) * 100)
            : null;
          return (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-3 px-3 py-2 rounded border border-border"
            >
              <span className="font-medium truncate max-w-[16rem]" title={item.file.name}>
                {item.file.name}
              </span>
              <span className="text-sm text-textSecondary">{formatBytes(item.file.size)}</span>
              {item.status === 'processing' && <span className="text-sm">Processing…</span>}
              {item.status === 'error' && (
                <span className="text-sm text-red-500">
                  Error:
                  {item.error}
                </span>
              )}
              {item.status === 'done' && item.result && (
                <>
                  <span className="text-sm">
                    →
                    {' '}
                    {formatBytes(item.result.size)}
                    {savings !== null && (
                      <span className={savings >= 0 ? ' text-green-600' : ' text-yellow-600'}>
                        {' '}
                        (
                        {savings >= 0 ? '−' : '+'}
                        {Math.abs(savings)}
                        %)
                      </span>
                    )}
                  </span>
                  {item.error && <span className="text-xs text-yellow-600">{item.error}</span>}
                  <button
                    type="button"
                    className="ml-auto px-3 py-1.5 rounded bg-primary text-white text-sm hover:bg-primary/90"
                    onClick={() => item.result && item.outName && downloadBlob(item.result, item.outName)}
                  >
                    Download
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
