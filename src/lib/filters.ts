/**
 * Filter utility functions for image processing
 * @category filters
 */

import type { FilterType } from '../types/filters';

/**
 * Apply grayscale filter to image data
 * @param imageData Source image data
 * @returns Grayscale image data
 */
export function applyGrayscale(imageData: ImageData): ImageData {
  const { width, height, data } = imageData;
  const result = new Uint8ClampedArray(data);

  for (let i = 0; i < result.length; i += 4) {
    // Standard luminance formula
    const gray = 0.299 * result[i] + 0.587 * result[i + 1] + 0.114 * result[i + 2];
    result[i] = gray;
    result[i + 1] = gray;
    result[i + 2] = gray;
  }

  return new ImageData(result, width, height);
}

/**
 * Apply sepia filter to image data
 * @param imageData Source image data
 * @returns Sepia image data
 */
export function applySepia(imageData: ImageData): ImageData {
  const { width, height, data } = imageData;
  const result = new Uint8ClampedArray(data);

  for (let i = 0; i < result.length; i += 4) {
    const r = result[i];
    const g = result[i + 1];
    const b = result[i + 2];

    result[i] = Math.min(255, 0.393 * r + 0.769 * g + 0.189 * b);
    result[i + 1] = Math.min(255, 0.349 * r + 0.686 * g + 0.168 * b);
    result[i + 2] = Math.min(255, 0.272 * r + 0.534 * g + 0.131 * b);
  }

  return new ImageData(result, width, height);
}

/**
 * Apply invert filter to image data
 * @param imageData Source image data
 * @returns Inverted image data
 */
export function applyInvert(imageData: ImageData): ImageData {
  const { width, height, data } = imageData;
  const result = new Uint8ClampedArray(data);

  for (let i = 0; i < result.length; i += 4) {
    result[i] = 255 - result[i];
    result[i + 1] = 255 - result[i + 1];
    result[i + 2] = 255 - result[i + 2];
  }

  return new ImageData(result, width, height);
}

/**
 * Apply blur filter to image data using separable convolution
 * @param imageData Source image data
 * @param radius Blur radius (default: 2)
 * @returns Blurred image data
 */
export function applyBlur(imageData: ImageData, radius: number = 2): ImageData {
  const kernel = generateBlurKernel(radius);
  return applySeparableConvolution(imageData, kernel, kernel);
}

/**
 * Apply sharpen filter to image data using separable convolution
 * @param imageData Source image data
 * @returns Sharpened image data
 */
export function applySharpen(imageData: ImageData): ImageData {
  const kernel = generateSharpenKernel();
  return applySeparableConvolution(imageData, kernel, kernel, 0, 1);
}

/**
 * Apply emboss filter to image data using separable convolution
 * @param imageData Source image data
 * @returns Embossed image data
 */
export function applyEmboss(imageData: ImageData): ImageData {
  const kernel = generateEmbossKernel();
  return applySeparableConvolution(imageData, kernel, kernel, 128, 1);
}

/**
 * Apply filter by name
 * @param imageData Source image data
 * @param filter Filter type to apply
 * @returns Filtered image data
 */
export function applyFilter(imageData: ImageData, filter: FilterType): ImageData {
  switch (filter) {
    case 'grayscale':
      return applyGrayscale(imageData);
    case 'sepia':
      return applySepia(imageData);
    case 'invert':
      return applyInvert(imageData);
    case 'blur':
      return applyBlur(imageData);
    case 'sharpen':
      return applySharpen(imageData);
    case 'emboss':
      return applyEmboss(imageData);
    default:
      return imageData;
  }
}

/**
 * Generate blur kernel for separable convolution
 * @param radius Blur radius
 * @returns Array of kernel weights
 */
function generateBlurKernel(radius: number): number[] {
  const size = radius * 2 + 1;
  const kernel = new Float32Array(size);
  const sigma = radius / 2;
  let sum = 0;

  for (let i = -radius; i <= radius; i++) {
    const val = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = val;
    sum += val;
  }

  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }

  return Array.from(kernel);
}

/**
 * Generate sharpen kernel for separable convolution
 * @returns Array of kernel weights
 */
function generateSharpenKernel(): number[] {
  return [-0.25, 1.5, -0.25];
}

/**
 * Generate emboss kernel for separable convolution
 * @returns Array of kernel weights
 */
function generateEmbossKernel(): number[] {
  return [-1, 0, 1];
}

/**
 * Apply separable convolution to image data
 * @param imageData Source image data
 * @param horizontalKernel Horizontal convolution kernel
 * @param verticalKernel Vertical convolution kernel
 * @param offset Brightness offset
 * @param scale Contrast scale
 * @returns Processed image data
 */
function applySeparableConvolution(
  imageData: ImageData,
  horizontalKernel: number[],
  verticalKernel: number[],
  offset: number = 0,
  scale: number = 1,
): ImageData {
  const { width, height, data } = imageData;
  const result = new Uint8ClampedArray(data);
  const radius = Math.floor(horizontalKernel.length / 2);

  // Horizontal pass (alpha untouched: result alpha = source alpha)
  const temp = new Float32Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = radius; x < width - radius; x++) {
      let r = 0;
      let g = 0;
      let b = 0;

      for (let k = 0; k < horizontalKernel.length; k++) {
        const kx = x + k - radius;
        const idx = (y * width + kx) * 4;
        const weight = horizontalKernel[k];

        r += data[idx] * weight;
        g += data[idx + 1] * weight;
        b += data[idx + 2] * weight;
      }

      const idx = (y * width + x) * 4;
      temp[idx] = r;
      temp[idx + 1] = g;
      temp[idx + 2] = b;
      temp[idx + 3] = data[idx + 3];
    }
  }

  // Vertical pass
  for (let x = 0; x < width; x++) {
    for (let y = radius; y < height - radius; y++) {
      let r = 0;
      let g = 0;
      let b = 0;

      for (let k = 0; k < verticalKernel.length; k++) {
        const ky = y + k - radius;
        const idx = (ky * width + x) * 4;
        const weight = verticalKernel[k];

        r += temp[idx] * weight;
        g += temp[idx + 1] * weight;
        b += temp[idx + 2] * weight;
      }

      const idx = (y * width + x) * 4;
      result[idx] = Math.min(255, Math.max(0, (r + offset) * scale));
      result[idx + 1] = Math.min(255, Math.max(0, (g + offset) * scale));
      result[idx + 2] = Math.min(255, Math.max(0, (b + offset) * scale));
      result[idx + 3] = data[idx + 3];
    }
  }

  return new ImageData(result, width, height);
}

/**
 * Apply brightness adjustment to image data
 * @param imageData Source image data
 * @param brightness Brightness value (-100 to 100)
 * @returns Adjusted image data
 */
export function applyBrightness(imageData: ImageData, brightness: number): ImageData {
  const { width, height, data } = imageData;
  const result = new Uint8ClampedArray(data);
  const factor = (259 * (brightness + 255)) / (255 * (259 - brightness));

  for (let i = 0; i < result.length; i += 4) {
    result[i] = factor * (result[i] - 128) + 128;
    result[i + 1] = factor * (result[i + 1] - 128) + 128;
    result[i + 2] = factor * (result[i + 2] - 128) + 128;
  }

  return new ImageData(result, width, height);
}

/**
 * Apply contrast adjustment to image data
 * @param imageData Source image data
 * @param contrast Contrast value (-100 to 100)
 * @returns Adjusted image data
 */
export function applyContrast(imageData: ImageData, contrast: number): ImageData {
  const { width, height, data } = imageData;
  const result = new Uint8ClampedArray(data);
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

  for (let i = 0; i < result.length; i += 4) {
    result[i] = factor * (result[i] - 128) + 128;
    result[i + 1] = factor * (result[i + 1] - 128) + 128;
    result[i + 2] = factor * (result[i + 2] - 128) + 128;
  }

  return new ImageData(result, width, height);
}

/**
 * Apply exposure adjustment to image data
 * @param imageData Source image data
 * @param exposure Exposure value (-100 to 100)
 * @returns Adjusted image data
 */
export function applyExposure(imageData: ImageData, exposure: number): ImageData {
  const { width, height, data } = imageData;
  const result = new Uint8ClampedArray(data);
  const factor = 1 + exposure / 100;

  for (let i = 0; i < result.length; i += 4) {
    result[i] = Math.min(255, result[i] * factor);
    result[i + 1] = Math.min(255, result[i + 1] * factor);
    result[i + 2] = Math.min(255, result[i + 2] * factor);
  }

  return new ImageData(result, width, height);
}

/**
 * Apply saturation adjustment to image data
 * @param imageData Source image data
 * @param saturation Saturation value (-100 to 100)
 * @returns Adjusted image data
 */
export function applySaturation(imageData: ImageData, saturation: number): ImageData {
  const { width, height, data } = imageData;
  const result = new Uint8ClampedArray(data);
  const satFactor = 1 + saturation / 100;

  for (let i = 0; i < result.length; i += 4) {
    const r = result[i];
    const g = result[i + 1];
    const b = result[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;

    result[i] = gray + (r - gray) * satFactor;
    result[i + 1] = gray + (g - gray) * satFactor;
    result[i + 2] = gray + (b - gray) * satFactor;
  }

  return new ImageData(result, width, height);
}

/**
 * Apply all adjustments to image data in a single pass.
 * Fuses brightness → contrast → exposure → saturation (same order as the
 * individual functions) so one loop + one buffer allocation replaces up to
 * four full-image passes. ~4x faster for typical slider edits.
 * @param imageData Source image data
 * @param adjustments Adjustment values
 * @returns Adjusted image data
 */
export function applyAdjustments(
  imageData: ImageData,
  adjustments: { brightness: number; contrast: number; saturation: number; exposure: number },
): ImageData {
  const {
    brightness, contrast, exposure, saturation,
  } = adjustments;
  if (brightness === 0 && contrast === 0 && exposure === 0 && saturation === 0) {
    return imageData;
  }

  const { data } = imageData;
  const result = new Uint8ClampedArray(data);

  // Same factor formulas as the individual apply* functions.
  const brightFactor = (259 * (brightness + 255)) / (255 * (259 - brightness));
  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const exposureFactor = 1 + exposure / 100;
  const saturationFactor = 1 + saturation / 100;
  const hasTone = brightness !== 0 || contrast !== 0;

  for (let i = 0; i < result.length; i += 4) {
    let r = result[i];
    let g = result[i + 1];
    let b = result[i + 2];

    if (hasTone) {
      // Brightness
      r = brightFactor * (r - 128) + 128;
      g = brightFactor * (g - 128) + 128;
      b = brightFactor * (b - 128) + 128;
      // Contrast
      r = contrastFactor * (r - 128) + 128;
      g = contrastFactor * (g - 128) + 128;
      b = contrastFactor * (b - 128) + 128;
    }

    if (exposure !== 0) {
      r *= exposureFactor;
      g *= exposureFactor;
      b *= exposureFactor;
    }

    if (saturation !== 0) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gray + (r - gray) * saturationFactor;
      g = gray + (g - gray) * saturationFactor;
      b = gray + (b - gray) * saturationFactor;
    }

    // Uint8ClampedArray clamps out-of-range writes automatically.
    result[i] = r;
    result[i + 1] = g;
    result[i + 2] = b;
  }

  return new ImageData(result, imageData.width, imageData.height);
}
