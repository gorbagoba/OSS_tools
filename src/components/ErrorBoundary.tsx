/**
 * Error boundary component for React applications
 * @category components
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
  logError?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Error boundary component to catch errors in child components
 * Renders fallback UI when error occurs
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, errorInfo: info });

    if (this.props.onError) {
      this.props.onError(error, info);
    }

    if (this.props.logError !== false) {
      // eslint-disable-next-line no-console
      console.error('ErrorBoundary caught an error:', error, info);
    }
  }

  private handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  public override render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="error-boundary bg-gray-800 border border-red-500 rounded-xl p-6">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 text-red-500">
              <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>

            <div className="flex-1">
              <h2 className="text-xl font-bold text-gray-100 mb-2">Something went wrong</h2>

              {this.state.error && (
                <div className="mb-4">
                  <p className="text-gray-400 text-sm font-mono">{this.state.error.toString()}</p>
                  {this.state.errorInfo && (
                    <details className="mt-2 text-xs text-gray-500">
                      <summary>Stack trace</summary>
                      <pre className="mt-2 overflow-auto max-h-32">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    </details>
                  )}
                </div>
              )}

              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={this.handleReset}
                  className="px-6 py-2 bg-green-500 text-black rounded-lg hover:bg-green-600 transition-colors font-medium"
                >
                  Try Again
                </button>
                <a
                  href="/"
                  className="px-6 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 transition-colors font-medium"
                >
                  Go Home
                </a>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
