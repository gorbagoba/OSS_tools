/**
 * HEIC → JPG converter — iPhone photos to universally readable JPEGs.
 * heic2any (WASM) is dynamically imported on first use; everything runs
 * locally in the browser.
 */
import React, {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { downloadBlob, formatBytes } from '../lib/pdfTools';
import { useToast } from './ToastProvider';

interface Output {
  url: string;
  blob: Blob;
  name: string;
}

interface Item {
  id: string;
  fileName: string;
  inSize: number;
  status: 'pending' | 'processing' | 'done' | 'error';
  outputs: Output[];
  error?: string;
}

const uid = (): string => Math.random().toString(36).slice(2, 10);

const isHeic = (file: File): boolean => /\.(heic|heif)$/i.test(file.name) || file.type === 'image/heic' || file.type === 'image/heif';

export function HeicConverter(): React.JSX.Element {
  const { show: toast } = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [quality, setQuality] = useState(90);
  const [dragOver, setDragOver] = useState(false);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<string[]>([]);
  // Ref guard: dropping new files mid-batch must not fight the running batch
  const runningRef = useRef(false);

  // Revoke all object URLs on unmount
  useEffect(() => () => {
    urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const convertAll = useCallback(
    async (files: File[]): Promise<void> => {
      runningRef.current = true;
      // revoke previews from the previous batch
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      urlsRef.current = [];

      const fresh: Item[] = files.map((file) => ({
        id: uid(),
        fileName: file.name,
        inSize: file.size,
        status: 'pending',
        outputs: [],
      }));
      setItems(fresh);
      setRunning(true);

      // dynamic import keeps the ~1.4 MB libheif bundle out of the main chunk
      const heic2any = (await import('heic2any')).default;

      for (let i = 0; i < fresh.length; i += 1) {
        const item = fresh[i];
        const file = files[i];
        setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, status: 'processing' } : it)));
        try {
          // eslint-disable-next-line no-await-in-loop
          const result = await heic2any({
            blob: file,
            toType: 'image/jpeg',
            quality: quality / 100,
          });
          const blobs = Array.isArray(result) ? result : [result];
          const outputs = blobs.map((blob, i) => {
            const url = URL.createObjectURL(blob);
            urlsRef.current.push(url);
            const suffix = blobs.length > 1 ? `-${i + 1}` : '';
            const name = `${item.fileName.replace(/\.[^.]+$/, '')}${suffix}.jpg`;
            return { url, blob, name };
          });
          setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, status: 'done', outputs } : it)));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, status: 'error', error: message } : it)));
        }
      }
      runningRef.current = false;
      setRunning(false);
      toast('HEIC conversion finished', 'success');
    },
    [quality, toast],
  );

  const handleFiles = useCallback(
    (files: FileList | null): void => {
      if (runningRef.current) {
        toast('Wait for the current batch to finish', 'info');
        return;
      }
      if (!files || files.length === 0) return;
      const heics = Array.from(files).filter(isHeic);
      if (heics.length === 0) {
        toast('No .heic/.heif files found', 'error');
        return;
      }
      void convertAll(heics);
    },
    [convertAll, toast],
  );

  return (
    <div className="card" aria-busy={running}>
      <h1 className="text-2xl font-bold mb-2">HEIC → JPG Converter</h1>
      <p className="text-textSecondary mb-4">
        Convert iPhone HEIC photos to universally supported JPEGs — locally, with no uploads.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".heic,.heif,image/heic,image/heif"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <div className="mb-4">
        <label htmlFor="heic-quality" className="block text-sm mb-1">
          JPEG quality:
          {' '}
          {quality}
        </label>
        <input
          id="heic-quality"
          type="range"
          min={10}
          max={100}
          value={quality}
          onChange={(e) => setQuality(Number(e.target.value))}
          className="w-40"
        />
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-label="Add HEIC files"
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
        <p className="font-medium">Drop .heic / .heif files here, or click to browse</p>
        <p className="text-sm text-textSecondary mt-1">
          Batch supported · files never leave your device
        </p>
      </div>

      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id} className="px-3 py-2 rounded border border-border">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium truncate max-w-[16rem]" title={item.fileName}>
                {item.fileName}
              </span>
              <span className="text-sm text-textSecondary">{formatBytes(item.inSize)}</span>
              {item.status === 'processing' && <span className="text-sm">Converting…</span>}
              {item.status === 'pending' && <span className="text-sm">Queued…</span>}
              {item.status === 'error' && (
                <span className="text-sm text-red-500">
                  Error:
                  {item.error}
                </span>
              )}
            </div>
            {item.outputs.length > 0 && (
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {item.outputs.map((out) => (
                  <div key={out.name} className="rounded border border-border p-2">
                    <img src={out.url} alt={out.name} className="w-full rounded mb-1" />
                    <p className="text-xs text-textSecondary truncate mb-1" title={out.name}>
                      {out.name}
                      {' '}
                      ·
                      {formatBytes(out.blob.size)}
                    </p>
                    <button
                      type="button"
                      className="w-full px-2 py-1 rounded bg-primary text-white text-xs hover:bg-primary/90"
                      onClick={() => downloadBlob(out.blob, out.name)}
                    >
                      Download
                    </button>
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
