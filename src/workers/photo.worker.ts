/**
 * Photo filter worker: applies the grayscale/sepia/invert/blur/sharpen/emboss
 * kernels from lib/filters off the main thread. Request/result messages are
 * correlated by `id` so parallel requests on one worker cannot swap results.
 * @category worker
 */

/// <reference lib="webworker" />

import {
  applyBlur,
  applyEmboss,
  applyGrayscale,
  applyInvert,
  applySepia,
  applySharpen,
} from '../lib/filters';
import type { WorkerError, WorkerMessage, WorkerResult } from '../types/worker';

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<WorkerMessage | { type: 'init' }>) => {
  const message = event.data;

  if (message.type === 'init') {
    workerScope.postMessage({ type: 'ready' });
    return;
  }

  const startTime = performance.now();

  try {
    const imageData = new ImageData(new Uint8ClampedArray(message.data), message.width, message.height);
    let resultImageData: ImageData;

    switch (message.filter) {
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
        resultImageData = applyBlur(imageData);
        break;
      case 'sharpen':
        resultImageData = applySharpen(imageData);
        break;
      case 'emboss':
        resultImageData = applyEmboss(imageData);
        break;
      default:
        throw new Error(`Unknown filter: ${message.filter}`);
    }

    const result: WorkerResult = {
      type: 'result',
      id: message.id,
      data: resultImageData.data.buffer,
      width: resultImageData.width,
      height: resultImageData.height,
      filter: message.filter,
      processingTime: performance.now() - startTime,
      transferTime: 0,
    };

    workerScope.postMessage(result, [resultImageData.data.buffer]);
  } catch (error) {
    const workerError: WorkerError = {
      type: 'error',
      id: message.id,
      message: error instanceof Error ? error.message : 'Unknown error',
      filter: message.filter,
    };
    workerScope.postMessage(workerError);
  }
};
