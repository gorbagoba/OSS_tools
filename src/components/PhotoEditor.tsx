/**
 * PhotoEditor component refactored with custom hooks
 * @category components
 */

import React, { useState, useRef, useEffect } from 'react';
import type { FilterType } from '../workers/utils';
import { useWorker } from '../hooks/useWorker';
import { applyAdjustments, applyFilter } from '../lib/filters';
import { getStorageItem, saveStorageItem } from '../lib/storage';

// Re-export FilterType for component
export type { FilterType } from '../workers/utils';

export const PhotoEditor: React.FC = () => {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [originalImageData, setOriginalImageData] = useState<ImageData | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterType | null>(null);
  const [adjustments, setAdjustments] = useState({
    brightness: 0,
    contrast: 0,
    saturation: 0,
    exposure: 0,
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [workerMetrics, setWorkerMetrics] = useState({
    totalRequests: 0,
    avgProcessingTime: 0,
    avgTransferTime: 0,
    workers: 0,
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const metricsRef = useRef({
    processingTimes: [] as number[],
    transferTimes: [] as number[],
  });
  const imageLoadedRef = useRef(false);

  // Initialize worker hook
  const { status, processWithWorker: processWithWorkerHook } = useWorker();

  const workerStatus: 'loading' | 'ready' | 'error' = status.ready
    ? 'ready'
    : status.error
      ? 'error'
      : 'loading';

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        setImage(img);
        processImage(img);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const processImage = (img: HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set canvas size to match image
    canvas.width = img.width;
    canvas.height = img.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(img, 0, 0);

    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setOriginalImageData(data);
    imageLoadedRef.current = true;
  };

  const handleAdjustmentChange = (key: keyof typeof adjustments, value: number) => {
    const newAdjustments = { ...adjustments, [key]: value };
    setAdjustments(newAdjustments);

    if (originalImageData && imageLoadedRef.current) {
      // Recalculate and redraw
      let result = applyAdjustments(originalImageData, newAdjustments);
      if (activeFilter) {
        result = applyFilter(result, activeFilter);
      }
      drawToCanvas(result);
    }
  };

  const handleFilterClick = async (filter: FilterType) => {
    if (!originalImageData || !imageLoadedRef.current) return;

    if (activeFilter === filter) {
      // Toggle off
      setActiveFilter(null);
      const result = applyAdjustments(originalImageData, adjustments);
      drawToCanvas(result);
    } else {
      setActiveFilter(filter);
      setIsProcessing(true);
      try {
        const filtered = await processWithWorker(originalImageData, filter);
        const result = applyAdjustments(filtered, adjustments);
        drawToCanvas(result);
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const drawToCanvas = (data: ImageData) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.putImageData(data, 0, 0);
  };

  // Process image with worker or fallback to main thread
  const processWithWorker = async (data: ImageData, filter: FilterType): Promise<ImageData> => {
    try {
      const result = await processWithWorkerHook(data, filter);

      // Track metrics
      if (result) {
        metricsRef.current.processingTimes.push(result.processingTime);
        metricsRef.current.transferTimes.push(result.processingTime / 10); // Estimate

        // Keep only last 100 samples
        if (metricsRef.current.processingTimes.length > 100) {
          metricsRef.current.processingTimes.shift();
          metricsRef.current.transferTimes.shift();
        }

        // Update metrics state
        const avgProcessing = metricsRef.current.processingTimes.reduce((a, b) => a + b, 0)
          / metricsRef.current.processingTimes.length;
        const avgTransfer = metricsRef.current.transferTimes.reduce((a, b) => a + b, 0)
          / metricsRef.current.transferTimes.length;
        setWorkerMetrics((prev) => ({
          ...prev,
          totalRequests: prev.totalRequests + 1,
          avgProcessingTime: avgProcessing,
          avgTransferTime: avgTransfer,
          workers: navigator.hardwareConcurrency || 4,
        }));

        return result.result;
      }
      return applyFilter(data, filter);
    } catch (error) {
      // Worker processing failed, fall back to main thread
      return applyFilter(data, filter);
    }
  };

  // Redraw preview when adjustments change (for non-sliders)
  useEffect(() => {
    if (originalImageData && imageLoadedRef.current) {
      let result = applyAdjustments(originalImageData, adjustments);
      if (activeFilter) {
        result = applyFilter(result, activeFilter);
      }
      drawToCanvas(result);
    }
  }, [adjustments, activeFilter]);

  const handleReset = () => {
    const resetAdjustments = {
      brightness: 0,
      contrast: 0,
      saturation: 0,
      exposure: 0,
    };
    setActiveFilter(null);
    setAdjustments(resetAdjustments);
    if (originalImageData && imageLoadedRef.current) {
      drawToCanvas(originalImageData);
    }

    // Save preferences
    const prefs = getStorageItem('photo_editor_settings', {
      brightness: 0,
      contrast: 0,
      saturation: 0,
      exposure: 0,
      lastFilter: null,
    });
    saveStorageItem('photo_editor_settings', {
      ...prefs,
      ...resetAdjustments,
      lastFilter: 'none',
    });
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas || !originalImageData) return;

    const link = document.createElement('a');
    link.download = 'edited-image.png';
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Photo Editor</h1>
        <div className="flex items-center gap-2 text-xs">
          {isProcessing && (
            <span className="flex items-center gap-1 text-blue-400 animate-pulse">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Processing...
            </span>
          )}
          <span
            className={`px-2 py-1 rounded-full ${
              workerStatus === 'ready'
                ? 'bg-green-500/20 text-green-400'
                : workerStatus === 'loading'
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : 'bg-red-500/20 text-red-400'
            }`}
          >
            {workerStatus === 'ready'
              ? 'Worker Active'
              : workerStatus === 'loading'
                ? 'Initializing…'
                : 'Worker Error'}
          </span>
        </div>
      </div>
      <p className="text-textSecondary mb-6">
        Edit your images with filters, adjustments, and tools. All processing happens locally in
        your browser.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-input border border-border rounded-xl p-6 flex flex-col items-center min-h-[400px]">
          <h3 className="text-lg font-medium mb-4">Preview</h3>

          <div className="relative w-full max-w-full">
            {image ? (
              <canvas
                ref={canvasRef}
                width={image.width}
                height={image.height}
                className="max-w-full max-h-[400px] rounded-lg"
              />
            ) : (
              <div className="text-textSecondary text-center py-20">
                <p className="text-lg">Upload an image to start editing</p>
                <p className="text-sm mt-2">Supports PNG, JPG, JPEG, GIF, WebP</p>
              </div>
            )}
          </div>

          <label className="mt-8 px-6 py-3 bg-input border border-border rounded-lg hover:border-primary transition-colors cursor-pointer text-sm font-medium">
            Upload Image
            <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
          </label>
        </div>

        <div className="bg-input border border-border rounded-xl p-6">
          <h2 className="text-lg font-medium mb-6">Adjustments</h2>

          <div className="space-y-6">
            <div>
              <label className="block text-sm text-textSecondary mb-2">Brightness</label>
              <input
                type="range"
                min="-100"
                max="100"
                value={adjustments.brightness}
                onChange={(e) => handleAdjustmentChange('brightness', parseInt(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>

            <div>
              <label className="block text-sm text-textSecondary mb-2">Contrast</label>
              <input
                type="range"
                min="-100"
                max="100"
                value={adjustments.contrast}
                onChange={(e) => handleAdjustmentChange('contrast', parseInt(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>

            <div>
              <label className="block text-sm text-textSecondary mb-2">Saturation</label>
              <input
                type="range"
                min="-100"
                max="100"
                value={adjustments.saturation}
                onChange={(e) => handleAdjustmentChange('saturation', parseInt(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>

            <div>
              <label className="block text-sm text-textSecondary mb-2">Exposure</label>
              <input
                type="range"
                min="-100"
                max="100"
                value={adjustments.exposure}
                onChange={(e) => handleAdjustmentChange('exposure', parseInt(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>

            <h2 className="text-lg font-medium mt-8 mb-4">Filters</h2>

            <div className="grid grid-cols-3 gap-3">
              {['grayscale', 'sepia', 'invert', 'blur', 'sharpen', 'emboss'].map((filter) => (
                <button
                  key={filter}
                  onClick={() => handleFilterClick(filter as FilterType)}
                  disabled={isProcessing || workerStatus === 'error'}
                  className={`relative px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeFilter === filter
                      ? 'bg-primary text-black'
                      : 'bg-input border border-border hover:border-primary text-textSecondary disabled:opacity-50 disabled:cursor-not-allowed'
                  }`}
                >
                  {filter.charAt(0).toUpperCase() + filter.slice(1)}
                  {isProcessing && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-3 h-3 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                    </div>
                  )}
                </button>
              ))}
            </div>

            {/* Worker Performance Metrics */}
            {workerStatus === 'ready' && (
              <div className="mt-6 pt-6 border-t border-border">
                <h3 className="text-sm font-medium text-textSecondary mb-3">Worker Performance</h3>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-gray-800/50 rounded-lg p-3">
                    <div className="text-gray-400 mb-1">Total Requests</div>
                    <div className="text-white font-mono">{workerMetrics.totalRequests}</div>
                  </div>
                  <div className="bg-gray-800/50 rounded-lg p-3">
                    <div className="text-gray-400 mb-1">Avg Processing</div>
                    <div className="text-white font-mono">
                      {workerMetrics.avgProcessingTime.toFixed(2)}
                      {' '}
                      ms
                    </div>
                  </div>
                  <div className="bg-gray-800/50 rounded-lg p-3">
                    <div className="text-gray-400 mb-1">Avg Transfer</div>
                    <div className="text-white font-mono">
                      {workerMetrics.avgTransferTime.toFixed(2)}
                      {' '}
                      ms
                    </div>
                  </div>
                  <div className="bg-gray-800/50 rounded-lg p-3">
                    <div className="text-gray-400 mb-1">Workers</div>
                    <div className="text-white font-mono">{workerMetrics.workers}</div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-4 mt-6 pt-6 border-t border-border">
              <button
                onClick={handleReset}
                className="flex-1 px-4 py-3 bg-input border border-border rounded-lg hover:border-primary transition-colors text-sm font-medium"
              >
                Reset All
              </button>
              <button
                onClick={handleDownload}
                disabled={!image}
                className="flex-1 px-4 py-3 bg-primary text-black rounded-lg hover:bg-green-600 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Download
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
