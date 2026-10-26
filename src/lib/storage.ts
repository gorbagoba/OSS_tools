/**
 * Local storage helper utilities
 * @category storage
 */

/**
 * Storage key prefix for app data
 */
const STORAGE_PREFIX = 'bgremover_';

/**
 * Get storage key with prefix
 * @param key Base key name
 * @returns Prefixed key
 */
function getStorageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`;
}

/**
 * Get value from local storage
 * @param key Storage key
 * @param defaultValue Default value if not found
 * @returns Stored value or default
 */
export function getStorageItem<T>(key: string, defaultValue: T): T {
  try {
    const stored = window.localStorage.getItem(getStorageKey(key));
    if (stored === null) return defaultValue;

    return JSON.parse(stored) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Set value in local storage
 * @param key Storage key
 * @param value Value to store
 * @returns true if successful
 */
export function setStorageItem<T>(key: string, value: T): boolean {
  try {
    window.localStorage.setItem(getStorageKey(key), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Get QR configuration from storage (private: merge base for saveQRConfig)
 * @returns QR configuration object
 */
function getQRConfig(): {
  defaultText: string;
  defaultSize: number;
  defaultErrorLevel: 'L' | 'M' | 'Q' | 'H';
  colorDark: string;
  colorLight: string;
} {
  return getStorageItem('qr_config', {
    defaultText: 'https://example.com',
    defaultSize: 300,
    defaultErrorLevel: 'M',
    colorDark: '#000000',
    colorLight: '#ffffff',
  });
}

/**
 * Save QR configuration
 * @param config Configuration to save
 * @returns true if successful
 */
export function saveQRConfig(config: Partial<{
  defaultText: string;
  defaultSize: number;
  defaultErrorLevel: 'L' | 'M' | 'Q' | 'H';
  colorDark: string;
  colorLight: string;
}>): boolean {
  const current = getQRConfig();
  const updated = { ...current, ...config };
  return setStorageItem('qr_config', updated);
}
