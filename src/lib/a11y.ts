/**
 * Accessibility utility functions
 * @category a11y
 */

/**
 * Get focusable elements within a container
 * @param container Container element to search
 * @returns Array of focusable elements
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const focusableSelectors = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    'audio[controls]',
    'video[controls]',
    '[contenteditable]:not([contenteditable="false"])',
  ].join(', ');

  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelectors));
}

/**
 * Trap focus within a container element
 * @param event Keyboard event (Tab key)
 * @param currentElement Currently focused element
 * @param container Container element to trap focus within
 * @returns true to prevent default, false to allow
 */
export function handleFocusTrap(
  event: React.KeyboardEvent,
  currentElement: HTMLElement,
  container: HTMLElement,
): boolean {
  if (event.key !== 'Tab') return false;

  const focusableElements = getFocusableElements(container);
  if (focusableElements.length === 0) return false;

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  if (event.shiftKey) {
    // Shift + Tab: moving backwards
    if (currentElement === firstElement) {
      lastElement.focus();
      return true;
    }
  } else {
    // Tab: moving forwards
    if (currentElement === lastElement) {
      firstElement.focus();
      return true;
    }
  }

  return false;
}

/**
 * Move focus to first focusable element in container
 * @param container Container element
 */
export function focusFirstElement(container: HTMLElement): void {
  const focusableElements = getFocusableElements(container);
  if (focusableElements.length > 0) {
    focusableElements[0].focus();
  }
}

/**
 * Move focus to last focusable element in container
 * @param container Container element
 */
export function focusLastElement(container: HTMLElement): void {
  const focusableElements = getFocusableElements(container);
  if (focusableElements.length > 0) {
    focusableElements[focusableElements.length - 1].focus();
  }
}

/**
 * Announce message to screen readers
 * @param container DOM element to use as announcement container
 * @param message Message to announce
 * @param priority Priority level (high or low)
 */
export function announceToScreenReader(
  container: HTMLElement,
  message: string,
  priority: 'high' | 'low' = 'low',
): void {
  const politeness = priority === 'high' ? 'assertive' : 'polite';

  // eslint-disable-next-line no-param-reassign
  container.setAttribute('aria-live', politeness);
  // eslint-disable-next-line no-param-reassign
  container.setAttribute('aria-atomic', 'true');
  // eslint-disable-next-line no-param-reassign
  container.setAttribute('role', 'status');

  // Clear previous message to ensure announcement
  // eslint-disable-next-line no-param-reassign
  container.textContent = '';

  // Small delay to ensure screen readers pick up the change
  setTimeout(() => {
    // eslint-disable-next-line no-param-reassign
    container.textContent = message;
  }, 50);
}

/**
 * Check if user prefers reduced motion
 * @returns true if user prefers reduced motion
 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Get reduced motion preference value for CSS
 * @returns 'no-preference' or 'reduce'
 */
export function getReducedMotionPreference(): 'no-preference' | 'reduce' {
  return prefersReducedMotion() ? 'reduce' : 'no-preference';
}

/**
 * Calculate contrast ratio between two colors
 * @param color1 First color (hex or rgb)
 * @param color2 Second color (hex or rgb)
 * @returns Contrast ratio (1-21)
 */
export function getContrastRatio(color1: string, color2: string): number {
  const luminance1 = getLuminance(color1);
  const luminance2 = getLuminance(color2);

  const lighter = Math.max(luminance1, luminance2);
  const darker = Math.min(luminance1, luminance2);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Calculate relative luminance of a color
 * @param color Color (hex or rgb)
 * @returns Luminance value (0-1)
 */
function getLuminance(color: string): number {
  const rgb = parseColor(color);
  if (!rgb) return 0;

  const [r, g, b] = rgb.map((c) => {
    // eslint-disable-next-line no-param-reassign
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Parse color string to RGB values
 * @param color Color string (hex or rgb)
 * @returns Array of RGB values or null if invalid
 */
function parseColor(color: string): number[] | null {
  if (color.startsWith('#')) {
    // Hex color
    const hex = color.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
      ];
    } if (hex.length === 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
  } else if (color.startsWith('rgb')) {
    // RGB color
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
    }
  }

  return null;
}

/**
 * Check if color contrast meets WCAG AA standards
 * @param color1 First color
 * @param color2 Second color
 * @param textSize Text size in pixels
 * @returns true if contrast meets AA standards
 */
export function meetsWCAGAA(color1: string, color2: string, textSize: number = 16): boolean {
  const ratio = getContrastRatio(color1, color2);

  // Text 14pt (18.66px) or bold: 4.5:1
  // Text < 14pt: 7:1
  if (textSize >= 18.66) {
    return ratio >= 4.5;
  }
  return ratio >= 7;
}

/**
 * Check if color contrast meets WCAG AAA standards
 * @param color1 First color
 * @param color2 Second color
 * @param textSize Text size in pixels
 * @returns true if contrast meets AAA standards
 */
export function meetsWCAGAAA(color1: string, color2: string, textSize: number = 16): boolean {
  const ratio = getContrastRatio(color1, color2);

  // Text 14pt (18.66px) or bold: 7:1
  // Text < 14pt: 4.5:1 (AA only)
  if (textSize >= 18.66) {
    return ratio >= 7;
  }
  return false;
}

/**
 * Generate accessible label from element
 * @param element Element to generate label from
 * @returns Accessible label string
 */
export function generateAccessibleLabel(element: HTMLElement): string {
  // Try aria-label first
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // Try title attribute
  const title = element.getAttribute('title');
  if (title) return title;

  // Try element text content
  const text = element.textContent?.trim();
  if (text) return text;

  // Try for element
  const htmlFor = element.getAttribute('for');
  if (htmlFor) {
    const label = document.querySelector(`label[for="${htmlFor}"]`);
    if (label) return label.textContent?.trim() || '';
  }

  return element.tagName.toLowerCase();
}
