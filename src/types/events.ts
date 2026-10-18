/**
 * Event handler types for accessibility and user interactions
 * @category events
 */

/**
 * Activity log entry for BackgroundRemover component
 */
export interface LogEntry {
  id: string;
  message: string;
  type: 'info' | 'error' | 'pending' | 'success';
  timestamp: string;
}

/**
 * Clipboard paste event handler
 */
export interface ClipboardPasteEventHandler {
  /**
   * Handle paste event with image data
   * @param event - Clipboard event containing image data
   */
  (event: React.ClipboardEvent<HTMLElement>): void;
}

/**
 * Drag and drop event handlers
 */
export interface DragDropHandlers {
  /** Handle drop event */
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
  /** Handle drag over event */
  onDragOver: (event: React.DragEvent<HTMLElement>) => void;
  /** Handle drag leave event */
  onDragLeave?: (event: React.DragEvent<HTMLElement>) => void;
}

/**
 * Keyboard event with typed key
 */
export interface TypedKeyboardEvent extends React.KeyboardEvent<HTMLElement> {
  /** Typed key value */
  key: string;
}

/**
 * Keyboard navigation handler
 */
export interface KeyboardNavigationHandler {
  /**
   * Handle keyboard navigation
   * @param event - Keyboard event
   * @param currentIndex - Current index in navigation list
   * @param maxIndex - Maximum index in navigation list
   * @returns New index or -1 if no action
   */
  (event: TypedKeyboardEvent, currentIndex: number, maxIndex: number): number;
}

/**
 * Focus trap handler
 */
export interface FocusTrapHandler {
  /**
   * Handle focus trap
   * @param event - Keyboard event (Tab key)
   * @param currentElement - Currently focused element
   * @param container - Focus trap container
   * @returns Whether to prevent default
   */
  (event: React.KeyboardEvent, currentElement: HTMLElement, container: HTMLElement): boolean;
}

/**
 * Live region announce options
 */
export interface LiveRegionOptions {
  /** Accessibility role */
  role?: 'alert' | 'status' | 'log' | 'marquee' | 'timer';
  /** Politeness level */
  politeness?: 'polite' | 'assertive';
  /** Announcement priority */
  priority?: 'high' | 'low';
}

/**
 * Image load event with target error handling
 */
export interface ImageLoadEvent extends React.SyntheticEvent<HTMLImageElement> {
  /** Image element that loaded */
  target: HTMLImageElement;
}

/**
 * File upload event handler
 */
export interface FileUploadEventHandler {
  /**
   * Handle file upload
   * @param event - Change event from file input
   */
  (event: React.ChangeEvent<HTMLInputElement>): void;
}

/**
 * Range input change handler with typed value
 */
export interface RangeChangeEventHandler {
  /**
   * Handle range value change
   * @param key - State key to update
   * @param value - New value from range input
   */
  (key: string, value: number): void;
}
