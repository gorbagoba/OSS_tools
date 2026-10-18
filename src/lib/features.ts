/**
 * Feature detection for browser capabilities
 * @category lib
 */

/**
 * Check if File System Access API is supported
 */
export function supportsFileSystemAccess(): boolean {
  return 'showOpenFilePicker' in window && 'showSaveFilePicker' in window;
}

/**
 * Check if Permissions API is supported
 */
export function supportsPermissions(): boolean {
  return 'permissions' in navigator;
}

/**
 * Check if Notifications API is supported
 */
export function supportsNotifications(): boolean {
  return 'Notification' in window && 'requestPermission' in Notification;
}

/**
 * Check if Clipboard API is supported
 */
export function supportsClipboard(): boolean {
  return 'clipboard' in navigator;
}

/**
 * Check if Web Workers are supported
 */
export function supportsWorkers(): boolean {
  return typeof Worker !== 'undefined' && typeof URL !== 'undefined' && typeof Blob !== 'undefined';
}
