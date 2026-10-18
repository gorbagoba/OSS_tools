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
 * Alias for setStorageItem (legacy compatibility)
 * @param key Storage key
 * @param value Value to store
 * @returns true if successful
 */
export const saveStorageItem = setStorageItem;

/**
 * Remove item from local storage
 * @param key Storage key
 * @returns true if successful
 */
export function removeStorageItem(key: string): boolean {
  try {
    window.localStorage.removeItem(getStorageKey(key));
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear all app storage items
 * @returns true if successful
 */
export function clearAppStorage(): boolean {
  try {
    const keysToRemove: string[] = [];

    // Get all keys with our prefix
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) {
        keysToRemove.push(key);
      }
    }

    // Remove all app keys
    keysToRemove.forEach((key) => window.localStorage.removeItem(key));

    return true;
  } catch {
    return false;
  }
}

/**
 * Get recent images from storage
 * @param maxCount Maximum number of recent images to return
 * @returns Array of recent image URLs
 */
export function getRecentImages(maxCount: number = 10): string[] {
  const images = getStorageItem<string[]>('recent_images', []);
  return images.slice(0, maxCount);
}

/**
 * Add image to recent images
 * @param url Image URL to add
 */
export function addRecentImage(url: string): void {
  const recent = getStorageItem<string[]>('recent_images', []);
  const filtered = recent.filter((img) => img !== url);
  filtered.unshift(url);
  setStorageItem('recent_images', filtered.slice(0, 10));
}

/**
 * Get user preferences
 * @returns User preferences object
 */
export function getUserPreferences(): {
  defaultModel: 'lite' | 'full';
  showWorkerMetrics: boolean;
  autoDownload: boolean;
} {
  return getStorageItem('user_preferences', {
    defaultModel: 'lite',
    showWorkerMetrics: true,
    autoDownload: false,
  });
}

/**
 * Save user preferences
 * @param preferences Preferences to save
 * @returns true if successful
 */
export function saveUserPreferences(preferences: Partial<{
  defaultModel: 'lite' | 'full';
  showWorkerMetrics: boolean;
  autoDownload: boolean;
}>): boolean {
  const current = getUserPreferences();
  const updated = { ...current, ...preferences };
  return setStorageItem('user_preferences', updated);
}

/**
 * Get QR configuration from storage
 * @returns QR configuration object
 */
export function getQRConfig(): {
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

/**
 * Get photo editor settings
 * @returns Photo editor settings
 */
export function getPhotoEditorSettings(): {
  brightness: number;
  contrast: number;
  saturation: number;
  exposure: number;
  lastFilter: string | null;
} {
  return getStorageItem('photo_editor_settings', {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    exposure: 0,
    lastFilter: null,
  });
}

/**
 * Save photo editor settings
 * @param settings Settings to save
 * @returns true if successful
 */
export function savePhotoEditorSettings(settings: Partial<{
  brightness: number;
  contrast: number;
  saturation: number;
  exposure: number;
  lastFilter: string | null;
}>): boolean {
  const current = getPhotoEditorSettings();
  const updated = { ...current, ...settings };
  return setStorageItem('photo_editor_settings', updated);
}

/**
 * Check if storage is available
 * @returns true if storage is available
 */
export function isStorageAvailable(): boolean {
  try {
    const testKey = getStorageKey('test');
    window.localStorage.setItem(testKey, 'test');
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get storage usage information
 * @returns Storage usage stats
 */
export function getStorageUsage(): {
  totalItems: number;
  appItems: number;
  estimatedSizeKB: number;
} {
  let appItems = 0;
  let estimatedSize = 0;

  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key) {
        if (key.startsWith(STORAGE_PREFIX)) {
          appItems++;
          const value = window.localStorage.getItem(key);
          if (value) {
            estimatedSize += (key.length + value.length);
          }
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return {
    totalItems: window.localStorage.length,
    appItems,
    estimatedSizeKB: Math.round(estimatedSize / 1024),
  };
}
