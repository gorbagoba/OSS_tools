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
