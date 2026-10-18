/**
 * Input validation utilities
 * @category validators
 */

/**
 * Validate URL string
 * @param url URL to validate
 * @returns true if valid URL
 */
export function isValidURL(url: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate QR code content length
 * @param content Content to validate
 * @param errorLevel Error correction level
 * @returns true if content length is valid
 */
export function isValidQRContent(content: string, errorLevel: 'L' | 'M' | 'Q' | 'H'): boolean {
  const maxLengths = {
    L: 7089, // Low error correction
    M: 5596, // Medium error correction
    Q: 3993, // Quartile error correction
    H: 3057, // High error correction
  };

  const encoder = new TextEncoder();
  const encoded = encoder.encode(content);
  const maxLength = maxLengths[errorLevel];

  return encoded.length <= maxLength;
}

/**
 * Validate file type for image upload
 * @param file File to validate
 * @returns true if image file
 */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/**
 * Validate image dimensions
 * @param width Image width
 * @param height Image height
 * @param maxWidth Maximum allowed width
 * @param maxHeight Maximum allowed height
 * @returns true if dimensions are valid
 */
export function isValidImageDimensions(
  width: number,
  height: number,
  maxWidth: number = 4096,
  maxHeight: number = 4096,
): boolean {
  return width > 0 && height > 0 && width <= maxWidth && height <= maxHeight;
}

/**
 * Validate adjustment values
 * @param value Adjustment value
 * @param min Minimum allowed value
 * @param max Maximum allowed value
 * @returns true if value is in valid range
 */
export function isValidAdjustmentValue(value: number, min: number = -100, max: number = 100): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Validate QR size
 * @param size QR size in pixels
 * @returns true if size is valid
 */
export function isValidQRSize(size: number): boolean {
  return Number.isInteger(size) && size >= 50 && size <= 1000;
}

/**
 * Validate color hex string
 * @param color Color string to validate
 * @returns true if valid hex color
 */
export function isValidHexColor(color: string): boolean {
  return /^#([0-9A-F]{3}){1,2}$/i.test(color);
}

/**
 * Validate RGB color values
 * @param r Red value (0-255)
 * @param g Green value (0-255)
 * @param b Blue value (0-255)
 * @returns true if all values are valid
 */
export function isValidRGB(r: number, g: number, b: number): boolean {
  return (
    Number.isInteger(r) && r >= 0 && r <= 255
    && Number.isInteger(g) && g >= 0 && g <= 255
    && Number.isInteger(b) && b >= 0 && b <= 255
  );
}

/**
 * Validate model choice
 * @param model Model name to validate
 * @returns true if valid model choice
 */
export function isValidModelChoice(model: string): model is 'lite' | 'full' {
  return model === 'lite' || model === 'full';
}

/**
 * Validate clipboard image data
 * @param items Clipboard items or DataTransfer items
 * @returns First image file or null
 */
export function getImageFromClipboard(items: ClipboardItems | DataTransfer | null): File | null {
  if (!items) return null;

  // Handle DataTransfer (drag/drop)
  if ('items' in items && items.items) {
    const arrayItems = Array.from(items.items);

    const found = arrayItems.find((item) => {
      if (item.type && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file && isImageFile(file)) {
          return true;
        }
      }
      return false;
    });

    if (found) {
      const file = found.getAsFile();
      if (file && isImageFile(file)) {
        return file;
      }
    }
  }

  // Handle ClipboardItems (paste)
  if ('forEach' in items) {
    items.forEach((item) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const types = (item as any).types as string[] | undefined;
      if (types && types.some((t) => t.startsWith('image/'))) {
        void item.getType('image/png').then((blob) => new File([blob], 'clipboard-image.png', { type: 'image/png' }));
      }
    });
  }

  return null;
}

/**
 * Validate image blob size
 * @param blob Image blob
 * @param maxSizeMB Maximum size in megabytes
 * @returns true if blob size is valid
 */
export function isValidBlobSize(blob: Blob, maxSizeMB: number = 10): boolean {
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  return blob.size <= maxSizeBytes;
}

/**
 * Validate text input for QR code
 * @param text Text to validate
 * @returns Validation result with validity and error message
 */
export function validateQRText(text: string): { valid: boolean; error?: string } {
  if (!text.trim()) {
    return { valid: false, error: 'QR content cannot be empty' };
  }

  if (text.length > 3000) {
    return { valid: false, error: 'QR content is too long (max 3000 characters)' };
  }

  // Check for problematic characters that might break QR
  const hasNewlines = text.includes('\n') || text.includes('\r');
  const hasNullBytes = text.includes('\0');

  if (hasNewlines || hasNullBytes) {
    return { valid: false, error: 'QR content contains invalid characters' };
  }

  return { valid: true };
}

/**
 * Validate file upload
 * @param file File to validate
 * @returns Validation result with validity and error message
 */
export function validateImageUpload(file: File): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: 'No file selected' };
  }

  if (!isImageFile(file)) {
    return { valid: false, error: 'Selected file is not an image' };
  }

  const supportedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
  if (!supportedTypes.includes(file.type)) {
    return { valid: false, error: `Unsupported image type: ${file.type}` };
  }

  if (file.size > 10 * 1024 * 1024) {
    return { valid: false, error: 'Image file is too large (max 10MB)' };
  }

  return { valid: true };
}

/**
 * Validate adjustment values
 * @param adjustments Adjustment values object
 * @returns Validation result with validity and error messages
 */
export function validateAdjustments(adjustments: {
  brightness: number;
  contrast: number;
  saturation: number;
  exposure: number;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!isValidAdjustmentValue(adjustments.brightness)) {
    errors.push('Brightness must be between -100 and 100');
  }

  if (!isValidAdjustmentValue(adjustments.contrast)) {
    errors.push('Contrast must be between -100 and 100');
  }

  if (!isValidAdjustmentValue(adjustments.saturation)) {
    errors.push('Saturation must be between -100 and 100');
  }

  if (!isValidAdjustmentValue(adjustments.exposure)) {
    errors.push('Exposure must be between -100 and 100');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
