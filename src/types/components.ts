/**
 * Component props types for type safety
 * @category components
 */

import type { ReactNode } from 'react';
import type { FilterType as FilterTypeBase } from './filters';

// Re-export FilterType for convenience
export type FilterType = FilterTypeBase;

/**
 * Layout component props
 */
export interface LayoutProps {
  /** Child components to render */
  children: ReactNode;
}

/**
 * Spinner component props
 */
export interface SpinnerProps {
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Color class for spinner */
  color?: string;
}

/**
 * BackgroundRemover component props
 */
export interface BackgroundRemoverProps {
  /** Default model choice */
  defaultModel?: 'lite' | 'full';
  /** Callback when image is processed */
  onImageProcessed?: (result: { url: string; processingTime: number }) => void;
  /** Callback when error occurs */
  onError?: (error: Error) => void;
}

/**
 * PhotoEditor component props
 */
export interface PhotoEditorProps {
  /** Initial image URL */
  initialImage?: string;
  /** Callback when image is loaded */
  onImageLoaded?: (width: number, height: number) => void;
  /** Callback when processing completes */
  onProcessingComplete?: (metrics: ProcessingMetrics) => void;
}

/**
 * QRGenerator component props
 */
export interface QRGeneratorProps {
  /** Default QR content */
  defaultText?: string;
  /** Default QR size */
  defaultSize?: number;
  /** Default error correction level */
  defaultErrorLevel?: 'L' | 'M' | 'Q' | 'H';
  /** Callback when QR code is generated */
  onQRGenerated?: (text: string, size: number) => void;
}

/**
 * Processing metrics from worker operations
 */
export interface ProcessingMetrics {
  /** Total requests processed */
  totalRequests: number;
  /** Average processing time in milliseconds */
  avgProcessingTime: number;
  /** Average transfer time in milliseconds */
  avgTransferTime: number;
  /** Number of active workers */
  workers: number;
  /** Success rate percentage */
  successRate: number;
}

/**
 * Worker status indicator props
 */
export interface WorkerStatusIndicatorProps {
  /** Current worker status */
  status: 'loading' | 'ready' | 'error';
  /** Processing in progress */
  isProcessing?: boolean;
  /** Optional metrics to display */
  metrics?: ProcessingMetrics;
}

/**
 * Log entry for activity logging
 */
export interface LogEntry {
  /** Unique identifier */
  id: string;
  /** Log message */
  message: string;
  /** Timestamp string */
  timestamp: string;
  /** Log type */
  type: 'info' | 'error' | 'pending' | 'success';
  /** Optional processing time */
  time?: number;
}

/**
 * Log area props
 */
export interface LogAreaProps {
  /** Log entries to display */
  logs: LogEntry[];
  /** Whether to show processing timer */
  showTimer?: boolean;
  /** Optional timer value in milliseconds */
  eta?: number;
  /** Callback to clear logs */
  onClear?: () => void;
}

/**
 * Filter button props
 */
export interface FilterButtonProps {
  /** Filter name */
  name: FilterType;
  /** Whether filter is active */
  isActive: boolean;
  /** Callback when filter is clicked */
  onClick: (filter: FilterType) => void;
  /** Whether processing is in progress */
  isProcessing: boolean;
}

/**
 * Adjustment slider props
 */
export interface AdjustmentSliderProps {
  /** Slider label */
  label: string;
  /** Current value */
  value: number;
  /** Minimum value */
  min: number;
  /** Maximum value */
  max: number;
  /** Callback when value changes */
  onChange: (value: number) => void;
  /** Step increment */
  step?: number;
  /** Unit suffix */
  unit?: string;
}

/**
 * QR configuration props
 */
export interface QRConfigProps {
  /** QR content text */
  text: string;
  /** Set text function */
  setText: (text: string) => void;
  /** QR size */
  size: number;
  /** Set size function */
  setSize: (size: number) => void;
  /** Error correction level */
  errorLevel: 'L' | 'M' | 'Q' | 'H';
  /** Set error level function */
  setErrorLevel: (level: 'L' | 'M' | 'Q' | 'H') => void;
  /** Dark color hex */
  colorDark: string;
  /** Set dark color function */
  setColorDark: (color: string) => void;
  /** Light color hex */
  colorLight: string;
  /** Set light color function */
  setColorLight: (color: string) => void;
}
