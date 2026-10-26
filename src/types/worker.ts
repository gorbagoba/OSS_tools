/**
 * Worker message types for filter processing
 * @category worker
 */

import type { FilterType } from './filters';

export type { FilterType };

/**
 * Message sent to worker for processing
 */
export interface WorkerMessage {
  /** Message type */
  type: 'process';
  /** Correlation id, echoed in the matching result/error */
  id: number;
  /** Image data as ArrayBuffer */
  data: ArrayBuffer;
  /** Image width */
  width: number;
  /** Image height */
  height: number;
  /** Filter to apply */
  filter: FilterType;
}

/**
 * Successful result from worker
 */
export interface WorkerResult {
  /** Message type */
  type: 'result';
  /** Correlation id of the request this result answers */
  id: number;
  /** Processed image data as ArrayBuffer */
  data: ArrayBuffer;
  /** Image width */
  width: number;
  /** Image height */
  height: number;
  /** Filter that was applied */
  filter: FilterType;
  /** Processing time in milliseconds */
  processingTime: number;
  /** Message transfer time in milliseconds */
  transferTime: number;
}

/**
 * Error message from worker
 */
export interface WorkerError {
  /** Message type */
  type: 'error';
  /** Correlation id of the request that failed */
  id: number;
  /** Error message */
  message: string;
  /** Filter that caused error */
  filter: FilterType;
}

/**
 * Union type for all worker message types
 */
export type WorkerMessageEvent = WorkerMessage | WorkerResult | WorkerError;
