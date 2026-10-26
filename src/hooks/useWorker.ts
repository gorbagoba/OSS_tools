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

/** Monotonic request id: workers echo it so parallel requests cannot swap results. */
let nextRequestId = 0;

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

      const requestId = nextRequestId;
      nextRequestId += 1;

      const processingStartTime = performance.now();

      return await new Promise((resolve, reject) => {
        const cleanup = () => {
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
        };

        const onMessage = (event: MessageEvent<WorkerResult | WorkerError>) => {
          const msg = event.data;

          // Another in-flight request on this worker produced this message.
          if (msg.id !== requestId) return;

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

        // Transfer a COPY of the buffer: transferring data.data.buffer itself
        // detaches the caller's ImageData (originalImageData), breaking all
        // later putImageData/reads on the main thread (e.g. Reset All).
        const bufferCopy = data.data.buffer.slice(0);

        const message: WorkerMessage = {
          type: 'process',
          id: requestId,
          data: bufferCopy,
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
 * Create a worker instance: Vite module worker sharing the filter kernels
 * from lib/filters (single source of truth, no duplicated inline script).
 */
function createWorker(): Worker {
  return new Worker(new URL('../workers/photo.worker.ts', import.meta.url), { type: 'module' });
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
