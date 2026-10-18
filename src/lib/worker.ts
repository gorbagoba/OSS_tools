/**
 * Worker utility functions for worker pool management
 * @category worker
 */

/**
 * Create transferable ImageData for zero-copy worker transfer
 * @param imageData Original ImageData
 * @returns Transferable object with ArrayBuffer
 */
export function createTransferableImageData(imageData: ImageData): { data: ArrayBuffer; width: number; height: number } {
  return {
    data: imageData.data.buffer,
    width: imageData.width,
    height: imageData.height,
  };
}

/**
 * Create ImageData from transferable data
 * @param data ArrayBuffer containing pixel data
 * @param width Image width
 * @param height Image height
 * @returns ImageData object
 */
export function createImageDataFromTransferable(data: ArrayBuffer, width: number, height: number): ImageData {
  return new ImageData(new Uint8ClampedArray(data), width, height);
}

/**
 * Check if Web Workers are supported in current browser
 * @returns true if workers are supported
 */
export function isWorkerSupported(): boolean {
  return typeof Worker !== 'undefined'
         && typeof URL !== 'undefined'
         && typeof Blob !== 'undefined'
         && typeof FileReader !== 'undefined';
}

/**
 * Get optimal worker pool size based on hardware concurrency
 * Falls back to 1 if hardware concurrency is not available
 * @returns Number of workers to create (1-8)
 */
export function getWorkerPoolSize(): number {
  const { hardwareConcurrency } = navigator;
  if (!hardwareConcurrency) return 4;
  return Math.max(1, Math.min(hardwareConcurrency, 8));
}

/**
 * Generate separable blur kernel (1D) for O(n) performance
 * Uses Gaussian approximation for better quality
 * @param radius Blur radius
 * @returns Array of kernel weights
 */
export function generateBlurKernel(radius: number): number[] {
  const size = radius * 2 + 1;
  const kernel = new Float32Array(size);

  // Gaussian approximation
  const sigma = radius / 2;
  let sum = 0;

  for (let i = -radius; i <= radius; i++) {
    const val = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = val;
    sum += val;
  }

  // Normalize
  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }

  return Array.from(kernel);
}

/**
 * Generate sharpen kernel (1D separable)
 * @returns Array of kernel weights
 */
export function generateSharpenKernel(): number[] {
  // 1D sharpen kernel: [-0.25, 1.5, -0.25]
  return [-0.25, 1.5, -0.25];
}

/**
 * Generate emboss kernel (1D separable)
 * @returns Array of kernel weights
 */
export function generateEmbossKernel(): number[] {
  // 1D emboss kernel: [-1, 0, 1]
  return [-1, 0, 1];
}

/**
 * Apply separable convolution to image data
 * Horizontal pass followed by vertical pass = O(n) instead of O(n²)
 * @param imageData Image data to process
 * @param horizontalKernel Horizontal convolution kernel
 * @param verticalKernel Vertical convolution kernel
 * @param offset Brightness offset
 * @param scale Contrast scale
 * @returns Processed ImageData
 */
export function applySeparableConvolution(
  imageData: ImageData,
  horizontalKernel: number[],
  verticalKernel: number[],
  offset: number = 0,
  scale: number = 1,
): ImageData {
  const { width, height, data } = imageData;
  const result = new Uint8ClampedArray(data);
  const radius = Math.floor(horizontalKernel.length / 2);

  // Horizontal pass
  const temp = new Float32Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = radius; x < width - radius; x++) {
      let r = 0; let g = 0; let b = 0; let
        a = 0;

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

  // Vertical pass
  for (let x = 0; x < width; x++) {
    for (let y = radius; y < height - radius; y++) {
      let r = 0; let g = 0; let b = 0; let
        a = 0;

      for (let k = 0; k < verticalKernel.length; k++) {
        const ky = y + k - radius;
        const idx = (ky * width + x) * 4;
        const weight = verticalKernel[k];

        r += temp[idx] * weight;
        g += temp[idx + 1] * weight;
        b += temp[idx + 2] * weight;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        a += temp[idx + 3] * weight;
      }

      const idx = (y * width + x) * 4;
      result[idx] = Math.min(255, Math.max(0, (r + offset) * scale));
      result[idx + 1] = Math.min(255, Math.max(0, (g + offset) * scale));
      result[idx + 2] = Math.min(255, Math.max(0, (b + offset) * scale));
      result[idx + 3] = data[idx + 3]; // Preserve alpha
    }
  }

  return new ImageData(result, width, height);
}

/**
 * Measure transfer time for worker communication
 * @returns High-resolution timestamp for transfer timing
 */
export function measureTransferStart(): number {
  return performance.now();
}

/**
 * Calculate elapsed time from transfer start
 * @param startTime Transfer start timestamp
 * @returns Elapsed time in milliseconds
 */
export function measureTransferEnd(startTime: number): number {
  return performance.now() - startTime;
}
