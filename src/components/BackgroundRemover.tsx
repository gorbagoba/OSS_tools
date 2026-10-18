/**
 * BackgroundRemover component with ModNet
 * @category components
 */

import React, { useState, useEffect, useRef } from 'react';
import { removeBackground } from '../removal';
import { Spinner } from './Spinner';
import type { LogEntry } from '../types/events';

export type { LogEntry };

// Main BackgroundRemover component
export function BackgroundRemover(): React.JSX.Element {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [eta, setEta] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    const id = Math.random().toString(36).substring(7);
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [
      ...prev,
      {
        id,
        message,
        timestamp,
        type,
      },
    ]);
  };

  const clearLogs = () => {
    setLogs([]);
    setEta(null);
  };

  useEffect(() => {
    addLog('Ready. Paste an image to remove the background.', 'info');
  }, []);

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const { items } = e.clipboardData;
    let file: File | null = null;

    Array.from(items).every((item) => {
      if (item.type.startsWith('image/') && !file) {
        file = item.getAsFile();
      }
      return !file;
    });

    if (!file) return;

    e.preventDefault();
    await processImage(file);
  };

  const handleDrop = async (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const { items } = e.dataTransfer;
    let file: File | null = null;

    Array.from(items).some((item) => {
      if (item.type.startsWith('image/')) {
        file = item.getAsFile();
        return !!file;
      }
      return false;
    });

    if (file) {
      await processImage(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const processImage = async (file: File) => {
    if (isProcessing) return;

    setIsProcessing(true);
    clearLogs();
    addLog('Image received. Starting ModNet...', 'pending');

    try {
      // Create preview URL
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      const url = URL.createObjectURL(file);
      setOriginalUrl(url);

      addLog('Running inference...', 'pending');

      const startTime = performance.now();

      const resultBlob = await removeBackground(file);
      const elapsed = performance.now() - startTime;

      if (resultImage) URL.revokeObjectURL(resultImage);
      const resultUrl = URL.createObjectURL(resultBlob);
      setResultImage(resultUrl);

      setEta(elapsed);
      addLog(`ModNet completed in ${(elapsed / 1000).toFixed(1)}s.`, 'info');
      addLog('Background removal complete.', 'info');
    } catch (error) {
      addLog(`Error: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!resultImage) return;

    const link = document.createElement('a');
    link.href = resultImage;
    link.download = 'background-removed.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopy = async () => {
    if (!resultImage) return;

    try {
      const response = await fetch(resultImage);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      addLog('Copied to clipboard!', 'info');
    } catch (error) {
      addLog('Copy failed. Use Download instead.', 'error');
    }
  };

  const handleReset = () => {
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    if (resultImage) URL.revokeObjectURL(resultImage);

    setOriginalUrl(null);
    setResultImage(null);
    clearLogs();
    addLog('Ready. Paste an image to remove the background.', 'info');
  };

  return (
    <div className="card">
      <h1 className="text-2xl font-bold mb-4">Background Remover</h1>
      <p className="text-textSecondary mb-4">
        Paste an image below or anywhere on the page. Runs 100% in your browser using local AI with ModNet.
      </p>

      <div className="border-2 border-border rounded-xl p-8 text-center">
        <div className="mb-4">
          {originalUrl && !resultImage && (
            <div className="inline-block max-w-full max-h-[400px]">
              <img
                src={originalUrl}
                alt="Original"
                className="max-w-full max-h-[400px] rounded-lg"
              />
            </div>
          )}
          {resultImage && (
            <div className="inline-block max-w-full max-h-[400px]">
              <img
                src={resultImage}
                alt="Result"
                className="max-w-full max-h-[400px] rounded-lg bg-white bg-[linear-gradient(45deg,#808080_25%,transparent_25%),linear-gradient(-45deg,#808080_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#808080_75%),linear-gradient(-45deg,transparent_75%,#808080_75%)] bg-[size:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0]"
              />
            </div>
          )}
          {!originalUrl && (
            <div className="text-textSecondary">
              <p>Paste with Ctrl+V (or Cmd+V) here.</p>
            </div>
          )}
        </div>

        <textarea
          ref={textareaRef}
          className="w-full min-h-[120px] p-3 bg-input border-2 border-border rounded-lg text-textSecondary placeholder:text-textSecondary/70 outline-none resize-vertical focus:border-primary"
          placeholder="Paste image here (Ctrl+V)"
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          disabled={isProcessing}
        />

        {(resultImage || originalUrl) && (
          <div className="flex gap-4 mt-6 justify-center">
            <button
              type="button"
              onClick={handleCopy}
              disabled={!resultImage || isProcessing}
              className="px-5 py-2.5 rounded-lg border border-border bg-input hover:border-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {isProcessing && <Spinner size="sm" />}
              Copy
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={!resultImage || isProcessing}
              className="px-5 py-2.5 rounded-lg border border-border bg-input hover:border-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {isProcessing && <Spinner size="sm" />}
              Download PNG
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="px-5 py-2.5 rounded-lg border border-border bg-input hover:border-primary transition-colors"
            >
              Reset
            </button>
          </div>
        )}
      </div>

      {isProcessing && (
        <div className="mt-8 text-center">
          <Spinner size="md" />
          <p className="mt-4 text-textSecondary">Processing image...</p>
        </div>
      )}

      <div className="mt-8">
        <div className="bg-input border border-border rounded-xl p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-sm font-semibold">Activity Log</h2>
            <button
              type="button"
              onClick={clearLogs}
              className="text-sm text-textSecondary hover:text-text transition-colors"
            >
              Clear
            </button>
          </div>

          {eta !== null && (
            <div className="mb-3">
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-green-500 to-blue-500 transition-all duration-200"
                  style={{ width: `${Math.min(100, (eta / 10000) * 100)}%` }}
                />
              </div>
              <div className="text-xs text-textSecondary mt-1">
                Processing time:
                {' '}
                {(eta / 1000).toFixed(1)}
                s
              </div>
            </div>
          )}

          <ol className="list-none p-0 m-0 max-h-[280px] overflow-y-auto custom-scrollbar">
            {logs.map((log) => (
              <li
                key={log.id}
                className={`flex gap-3 py-2 border-b border-gray-800 last:border-0 ${
                  log.type === 'error'
                    ? 'text-red-400'
                    : log.type === 'pending'
                      ? 'text-yellow-500'
                      : 'text-textSecondary'
                }`}
              >
                <span className="text-xs text-gray-500 whitespace-nowrap">{log.timestamp}</span>
                <span className="flex-1">{log.message}</span>
              </li>
            ))}
            {logs.length === 0 && (
              <li className="text-textSecondary/50 italic py-2">No activity yet</li>
            )}
          </ol>
        </div>
      </div>
    </div>
  );
}
