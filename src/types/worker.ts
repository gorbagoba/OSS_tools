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
  /** Image data as ArrayBuffer */
  data: ArrayBuffer;
  /** Image width */
  width: number;
  /** Image height */
  height: number;
  /** Filter to apply */
  filter: FilterType;
  /** Optional filter configuration */
  config?: WorkerFilterConfig;
}

/**
 * Configuration for specific filters
 */
export interface WorkerFilterConfig {
  /** Blur radius (default: 2) */
  radius?: number;
}

/**
 * Successful result from worker
 */
export interface WorkerResult {
  /** Message type */
  type: 'result';
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
  /** Error message */
  message: string;
  /** Filter that caused error */
  filter: FilterType;
}

/**
 * Union type for all worker message types
 */
export type WorkerMessageEvent = WorkerMessage | WorkerResult | WorkerError;

/**
 * Worker pool initialization message
 */
export interface WorkerInit {
  /** Message type */
  type: 'init';
}

/**
 * Worker ready confirmation
 */
export interface WorkerReady {
  /** Message type */
  type: 'ready';
}

/**
 * Worker shutdown request
 */
export interface WorkerShutdown {
  /** Message type */
  type: 'shutdown';
}

/**
 * Worker shutdown confirmation
 */
export interface WorkerShutdownComplete {
  /** Message type */
  type: 'shutdown_complete';
}

/**
 * Worker status inquiry
 */
export interface WorkerStatusRequest {
  /** Message type */
  type: 'status';
}

/**
 * Worker status response
 */
export interface WorkerStatus {
  /** Message type */
  type: 'status';
  /** Whether worker is ready */
  ready: boolean;
  /** Worker ID for tracking */
  workerId: number;
}

/**
 * Message type guard
 */
export function isWorkerMessage(event: MessageEvent): event is MessageEvent<WorkerMessage> {
  return event.data && event.data.type === 'process';
}

/**
 * Result type guard
 */
export function isWorkerResult(event: MessageEvent): event is MessageEvent<WorkerResult> {
  return event.data && event.data.type === 'result';
}

/**
 * Error type guard
 */
export function isWorkerError(event: MessageEvent): event is MessageEvent<WorkerError> {
  return event.data && event.data.type === 'error';
}

/**
 * Ready type guard
 */
export function isWorkerReady(event: MessageEvent): event is MessageEvent<WorkerReady> {
  return event.data && event.data.type === 'ready';
}

/**
 * Status request type guard
 */
export function isWorkerStatusRequest(event: MessageEvent): event is MessageEvent<WorkerStatusRequest> {
  return event.data && event.data.type === 'status';
}

/**
 * Status response type guard
 */
export function isWorkerStatus(event: MessageEvent): event is MessageEvent<WorkerStatus> {
  return event.data && event.data.type === 'status';
}
