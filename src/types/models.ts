/**
 * BiRefNet model types for background removal
 * @category models
 */

/**
 * Model configuration options
 */
export interface ModelConfig {
  /** Model size variant */
  variant: 'lite' | 'full';
  /** Input image size (default: 512) */
  inputSize?: number;
  /** Confidence threshold for background removal */
  threshold?: number;
}

/**
 * Background removal result
 */
export interface RemovalResult {
  /** Transparent PNG blob with removed background */
  blob: Blob;
  /** Processing time in milliseconds */
  processingTime: number;
  /** Model variant used */
  modelVariant: 'lite' | 'full';
}

/**
 * Pipeline instance type
 */
export type BackgroundRemovalPipeline = {
  /** Process an image and return mask/segmentation */
  (input: Blob | HTMLImageElement | HTMLCanvasElement): Promise<RawImage | RawImage[]>;
  /** Pipeline configuration */
  config: ModelConfig;
};

/**
 * Raw image data from pipeline output
 */
export interface RawImage {
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** RGBA pixel data (alpha channel indicates background removal) */
  data: Uint8ClampedArray;
}
