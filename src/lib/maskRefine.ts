/**
 * Mask post-processing for background removal.
 *
 * Cleans up the raw alpha mask from the segmentation model so cutouts have
 * crisp edges instead of dark fringe/halo:
 * 1. grow — morphological dilation (positive radius) / erosion (negative),
 *    pulls the boundary 1px toward the subject so dark edge fringes are
 *    captured fully instead of half-transparent
 * 2. feather — separable Gaussian blur that smooths the stepped boundary
 *    produced by dilation into a clean 1px transition
 * 3. alphaBoost — lifts mid-range alpha to remove residual semi-transparency
 *
 * Pure TypeScript, DOM-free, so it is unit-testable from Node.
 */

export interface RefineMaskOptions {
  /**
   * Morphological radius in whole pixels. Positive dilates (grows the
   * subject), negative erodes (shrinks it). 0 disables. Default 1.
   */
  grow?: number;

  /** Gaussian feather radius in whole pixels (sigma = 1). 0 disables. Default 1. */
  feather?: number;

  /** Multiplier applied to alpha, clamped to 1. 1 disables. Default 1.12. */
  alphaBoost?: number;
}

/**
 * Refine a raw segmentation mask into clean alpha values in [0, 1].
 *
 * @param data - Mask pixels in row-major order. Channel 0 is treated as
 *               alpha; interleaved (e.g. RGBA) layouts are accepted.
 *               Values on the 0-255 (uint8) or 0-1 scale.
 * @param width - Mask width in pixels.
 * @param height - Mask height in pixels.
 * @param options - Refinement parameters (all optional).
 * @returns Float32Array of width * height alpha values in [0, 1].
 */
export function refineMask(
  data: ArrayLike<number>,
  width: number,
  height: number,
  options: RefineMaskOptions = {},
): Float32Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`refineMask: invalid dimensions ${width}x${height}`);
  }

  const pixelCount = width * height;
  const channels = data.length / pixelCount;
  if (!Number.isInteger(channels) || channels <= 0) {
    throw new Error(
      `refineMask: data length ${data.length} is not a multiple of ${width}x${height}`,
    );
  }

  const { grow = 1, feather = 1, alphaBoost = 1.12 } = options;

  // Extract channel 0 (alpha) and normalize to [0, 1].
  const source = new Float32Array(pixelCount);
  let max = 0;
  for (let i = 0; i < pixelCount; i += 1) {
    const value = data[i * channels];
    source[i] = value;
    if (value > max) max = value;
  }
  if (max > 1.5) {
    // uint8 0-255 scale
    for (let i = 0; i < pixelCount; i += 1) {
      source[i] /= 255;
    }
  }

  let mask: Float32Array = source;
  const growRadius = Math.floor(Math.abs(grow));
  if (growRadius > 0) {
    mask = grow > 0
      ? boxMax(mask, width, height, growRadius)
      : boxMin(mask, width, height, growRadius);
  }

  const featherRadius = Math.floor(feather);
  if (featherRadius > 0) {
    mask = gaussianPass(mask, width, height, makeGaussianKernel(featherRadius));
  }

  const out = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    out[i] = Math.min(1, mask[i] * alphaBoost);
  }
  return out;
}

/** Separable box filter keeping the maximum (dilation). */
function boxMax(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const horizontal = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let value = -1;
      for (let k = -radius; k <= radius; k += 1) {
        const kx = Math.min(width - 1, Math.max(0, x + k));
        const candidate = src[row + kx];
        if (candidate > value) value = candidate;
      }
      horizontal[row + x] = value;
    }
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = -1;
      for (let k = -radius; k <= radius; k += 1) {
        const ky = Math.min(height - 1, Math.max(0, y + k));
        const candidate = horizontal[ky * width + x];
        if (candidate > value) value = candidate;
      }
      out[y * width + x] = value;
    }
  }
  return out;
}

/** Separable box filter keeping the minimum (erosion). */
function boxMin(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const horizontal = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let value = 2;
      for (let k = -radius; k <= radius; k += 1) {
        const kx = Math.min(width - 1, Math.max(0, x + k));
        const candidate = src[row + kx];
        if (candidate < value) value = candidate;
      }
      horizontal[row + x] = value;
    }
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 2;
      for (let k = -radius; k <= radius; k += 1) {
        const ky = Math.min(height - 1, Math.max(0, y + k));
        const candidate = horizontal[ky * width + x];
        if (candidate < value) value = candidate;
      }
      out[y * width + x] = value;
    }
  }
  return out;
}

/** Normalized 1D Gaussian kernel (sigma = 1) for the given radius. */
function makeGaussianKernel(radius: number): number[] {
  const kernel: number[] = [];
  let sum = 0;
  for (let d = -radius; d <= radius; d += 1) {
    const weight = Math.exp(-(d * d) / 2);
    kernel.push(weight);
    sum += weight;
  }
  for (let i = 0; i < kernel.length; i += 1) {
    kernel[i] /= sum;
  }
  return kernel;
}

/** Separable Gaussian blur with replicated (clamped) boundaries. */
function gaussianPass(
  src: Float32Array,
  width: number,
  height: number,
  kernel: number[],
): Float32Array {
  const radius = Math.floor(kernel.length / 2);
  const horizontal = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      for (let k = 0; k < kernel.length; k += 1) {
        const kx = Math.min(width - 1, Math.max(0, x + k - radius));
        value += kernel[k] * src[row + kx];
      }
      horizontal[row + x] = value;
    }
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      for (let k = 0; k < kernel.length; k += 1) {
        const ky = Math.min(height - 1, Math.max(0, y + k - radius));
        value += kernel[k] * horizontal[ky * width + x];
      }
      out[y * width + x] = value;
    }
  }
  return out;
}
