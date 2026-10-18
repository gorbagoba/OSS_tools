/**
 * Custom hook for worker management
 * @category hooks
 */

import {
  useState, useEffect, useCallback, useRef,
} from 'react';
import type {
  WorkerMessage, WorkerResult, WorkerError, FilterType,
} from '../types/worker';

export interface WorkerPoolStatus {
  supported: boolean;
  ready: boolean;
  error: string | null;
  workerCount: number;
}

/**
 * Hook to manage worker pool for image processing
 * @param initialWorkerCount Initial number of workers to create
 * @returns Worker pool status and methods
 */
export function useWorker(initialWorkerCount: number = 4) {
  const [status, setStatus] = useState<WorkerPoolStatus>({
    supported: typeof Worker !== 'undefined',
    ready: false,
    error: null,
    workerCount: initialWorkerCount,
  });
  const [metrics, setMetrics] = useState({
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    totalProcessingTime: 0,
    avgProcessingTime: 0,
  });
  const workersRef = useRef<Worker[]>([]);
  const nextWorkerIndexRef = useRef(0);
  const initGenRef = useRef(0);

  /**
   * Initialize worker pool
   */
  const initializeWorkers = useCallback(async (): Promise<boolean> => {
    if (!status.supported) {
      setStatus((prev) => ({ ...prev, ready: false, error: 'Workers not supported' }));
      return false;
    }

    const gen = ++initGenRef.current;

    try {
      // Terminate existing workers
      workersRef.current.forEach((worker) => worker.terminate());
      workersRef.current = [];

      // Create new workers
      for (let i = 0; i < status.workerCount; i += 1) {
        const worker = createWorker();
        workersRef.current.push(worker);
      }

      // Wait for all workers to be ready
      await Promise.all(workersRef.current.map((w) => waitForWorkerReady(w)));

      // A newer init superseded this one (e.g. StrictMode remount) —
      // do not clobber the newer pool's status.
      if (gen !== initGenRef.current) {
        return false;
      }

      setStatus((prev) => ({ ...prev, ready: true, error: null }));
      return true;
    } catch (error) {
      if (gen !== initGenRef.current) {
        return false;
      }

      setStatus((prev) => ({
        ...prev,
        ready: false,
        error: error instanceof Error ? error.message : 'Worker initialization failed',
      }));
      return false;
    }
  }, [status.supported, status.workerCount]);

  /**
   * Terminate all workers
   */
  const terminateWorkers = useCallback(() => {
    workersRef.current.forEach((worker) => {
      try {
        worker.terminate();
      } catch {
        // Ignore termination errors
      }
    });
    workersRef.current = [];
    nextWorkerIndexRef.current = 0;
    setStatus((prev) => ({ ...prev, ready: false }));
  }, []);

  /**
   * Process image with worker
   * @param data Image data to process
   * @param filter Filter to apply
   * @returns Processed result with metrics
   */
  const processWithWorker = useCallback(async (
    data: ImageData,
    filter: FilterType,
  ): Promise<{ result: ImageData; processingTime: number } | null> => {
    if (!status.ready || workersRef.current.length === 0) {
      return null;
    }

    try {
      const worker = workersRef.current[nextWorkerIndexRef.current];
      nextWorkerIndexRef.current = (nextWorkerIndexRef.current + 1) % workersRef.current.length;

      const processingStartTime = performance.now();

      return await new Promise((resolve, reject) => {
        const cleanup = () => {
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
        };

        const onMessage = (event: MessageEvent<WorkerResult | WorkerError>) => {
          const msg = event.data;

          if (msg.type === 'result') {
            cleanup();
            const processingTime = performance.now() - processingStartTime;

            setMetrics((prev) => ({
              ...prev,
              totalRequests: prev.totalRequests + 1,
              successfulRequests: prev.successfulRequests + 1,
              totalProcessingTime: prev.totalProcessingTime + processingTime,
              avgProcessingTime: (prev.totalProcessingTime + processingTime) / (prev.successfulRequests + 1),
            }));

            resolve({
              result: createImageDataFromTransferable(msg.data, msg.width, msg.height),
              processingTime,
            });
          } else if (msg.type === 'error') {
            cleanup();
            reject(new Error(msg.message));
          }
        };

        const onError = () => {
          cleanup();
          reject(new Error('Worker processing error'));
        };

        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);

        const message: WorkerMessage = {
          type: 'process',
          data: data.data.buffer,
          width: data.width,
          height: data.height,
          filter,
        };

        worker.postMessage(message, [message.data]);
      });
    } catch (error) {
      setMetrics((prev) => ({
        ...prev,
        totalRequests: prev.totalRequests + 1,
        failedRequests: prev.failedRequests + 1,
      }));
      return null;
    }
  }, [status.ready]);

  /**
   * Reset worker pool
   */
  const resetPool = useCallback(async () => {
    terminateWorkers();
    return initializeWorkers();
  }, [terminateWorkers, initializeWorkers]);

  /**
   * Get worker metrics
   */
  const getMetrics = useCallback(() => ({ ...metrics }), [metrics]);

  // Init pool when supported and not yet ready. Deps do NOT include
  // terminateWorkers: cleanup on status.ready flipping true would
  // terminate the pool and re-trigger init in an infinite loop.
  useEffect(() => {
    if (status.supported && !status.ready) {
      initializeWorkers();
    }
  }, [status.supported, status.ready, initializeWorkers]);

  // Tear down pool on unmount only (terminateWorkers is stable).
  useEffect(() => () => {
    terminateWorkers();
  }, [terminateWorkers]);

  return {
    status,
    metrics,
    processWithWorker,
    initializeWorkers,
    terminateWorkers,
    resetPool,
    getMetrics,
  };
}

/**
 * Create a worker instance from inline script
 */
function createWorker(): Worker {
  const workerScript = `
    self.onmessage = function(event) {
      const message = event.data;

      if (message.type === 'init') {
        self.postMessage({ type: 'ready' });
        return;
      }

      const { data, width, height, filter } = message;
      
      try {
        const startTime = performance.now();
        
        const imageData = new ImageData(new Uint8ClampedArray(data), width, height);
        let resultImageData;
        
        switch (filter) {
          case 'grayscale':
            resultImageData = applyGrayscale(imageData);
            break;
          case 'sepia':
            resultImageData = applySepia(imageData);
            break;
          case 'invert':
            resultImageData = applyInvert(imageData);
            break;
          case 'blur':
            resultImageData = applyBlurWorker(imageData);
            break;
          case 'sharpen':
            resultImageData = applySharpenWorker(imageData);
            break;
          case 'emboss':
            resultImageData = applyEmbossWorker(imageData);
            break;
          default:
            throw new Error('Unknown filter: ' + filter);
        }
        
        const processingTime = performance.now() - startTime;
        
        const result = {
          type: 'result',
          data: resultImageData.data.buffer,
          width: resultImageData.width,
          height: resultImageData.height,
          filter,
          processingTime,
          transferTime: 0
        };
        
        self.postMessage(result, [resultImageData.data.buffer]);
      } catch (error) {
        self.postMessage({
          type: 'error',
          message: error.message || 'Unknown error',
          filter
        });
      }
    };
    
    function applyGrayscale(imageData) {
      const { width, height, data } = imageData;
      const result = new Uint8ClampedArray(data);
      for (let i = 0; i < result.length; i += 4) {
        const gray = 0.299 * result[i] + 0.587 * result[i + 1] + 0.114 * result[i + 2];
        result[i] = gray;
        result[i + 1] = gray;
        result[i + 2] = gray;
      }
      return new ImageData(result, width, height);
    }
    
    function applySepia(imageData) {
      const { width, height, data } = imageData;
      const result = new Uint8ClampedArray(data);
      for (let i = 0; i < result.length; i += 4) {
        const r = result[i], g = result[i + 1], b = result[i + 2];
        result[i] = Math.min(255, 0.393 * r + 0.769 * g + 0.189 * b);
        result[i + 1] = Math.min(255, 0.349 * r + 0.686 * g + 0.168 * b);
        result[i + 2] = Math.min(255, 0.272 * r + 0.534 * g + 0.131 * b);
      }
      return new ImageData(result, width, height);
    }
    
    function applyInvert(imageData) {
      const { width, height, data } = imageData;
      const result = new Uint8ClampedArray(data);
      for (let i = 0; i < result.length; i += 4) {
        result[i] = 255 - result[i];
        result[i + 1] = 255 - result[i + 1];
        result[i + 2] = 255 - result[i + 2];
      }
      return new ImageData(result, width, height);
    }
    
    function applyBlurWorker(imageData) {
      return applySeparableConvolution(imageData, [0.0625, 0.25, 0.375, 0.25, 0.0625], [0.0625, 0.25, 0.375, 0.25, 0.0625]);
    }
    
    function applySharpenWorker(imageData) {
      return applySeparableConvolution(imageData, [-0.25, 1.5, -0.25], [-0.25, 1.5, -0.25], 0, 1);
    }
    
    function applyEmbossWorker(imageData) {
      return applySeparableConvolution(imageData, [-1, 0, 1], [-1, 0, 1], 128, 1);
    }
    
    function applySeparableConvolution(imageData, horizontalKernel, verticalKernel, offset, scale) {
      const { width, height, data } = imageData;
      const result = new Uint8ClampedArray(data);
      const radius = Math.floor(horizontalKernel.length / 2);
      const temp = new Float32Array(width * height * 4);
      
      for (let y = 0; y < height; y++) {
        for (let x = radius; x < width - radius; x++) {
          let r = 0, g = 0, b = 0, a = 0;
          for (let k = 0; k < horizontalKernel.length; k++) {
            const kx = x + k - radius;
            const idx = (y * width + kx) * 4;
            const weight = horizontalKernel[k];
            r += data[idx] * weight;
            g += data[idx + 1] * weight;
            b += data[idx + 2] * weight;
            a += data[idx + 3] * weight;
          }
          const idx = (y * width + x) * 4;
          temp[idx] = r;
          temp[idx + 1] = g;
          temp[idx + 2] = b;
          temp[idx + 3] = a;
        }
      }
      
      for (let x = 0; x < width; x++) {
        for (let y = radius; y < height - radius; y++) {
          let r = 0, g = 0, b = 0, a = 0;
          for (let k = 0; k < verticalKernel.length; k++) {
            const ky = y + k - radius;
            const idx = (ky * width + x) * 4;
            const weight = verticalKernel[k];
            r += temp[idx] * weight;
            g += temp[idx + 1] * weight;
            b += temp[idx + 2] * weight;
            a += temp[idx + 3] * weight;
          }
          const idx = (y * width + x) * 4;
          result[idx] = Math.min(255, Math.max(0, (r + (offset || 0)) * (scale || 1)));
          result[idx + 1] = Math.min(255, Math.max(0, (g + (offset || 0)) * (scale || 1)));
          result[idx + 2] = Math.min(255, Math.max(0, (b + (offset || 0)) * (scale || 1)));
          result[idx + 3] = data[idx + 3];
        }
      }
      
      return new ImageData(result, width, height);
    }
  `;

  const workerUrl = URL.createObjectURL(
    new Blob([workerScript], { type: 'application/javascript' }),
  );

  const worker = new Worker(workerUrl);

  worker.addEventListener('error', () => {
    URL.revokeObjectURL(workerUrl);
  });

  return worker;
}

/**
 * Wait for worker to be ready
 */
function waitForWorkerReady(worker: Worker): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Worker initialization timeout')), 5000);

    const cleanup = () => {
      clearTimeout(timeout);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'ready') {
        cleanup();
        resolve();
      }
    };

    const onError = () => {
      cleanup();
      reject(new Error('Worker initialization error'));
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ type: 'init' });
  });
}

/**
 * Create ImageData from transferable data
 */
function createImageDataFromTransferable(data: ArrayBuffer, width: number, height: number): ImageData {
  return new ImageData(new Uint8ClampedArray(data), width, height);
}
