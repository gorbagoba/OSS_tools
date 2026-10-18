/**
 * High-order component to wrap component with error boundary
 */

import type React from 'react';
import type { ReactNode } from 'react';

import { ErrorBoundary } from './ErrorBoundary';

interface Props {
  fallback?: ReactNode;
}

/**
 * High-order component to wrap component with error boundary
 */
export function withErrorBoundary<T extends React.ComponentType<any>>(
  Component: T,
  fallback?: ReactNode,
): React.FC<React.ComponentProps<T> & Props> {
  return function WrappedComponent(props: React.ComponentProps<T> & Props) {
    return (
      <ErrorBoundary fallback={fallback}>
        <Component {...(props as React.ComponentProps<T>)} />
      </ErrorBoundary>
    );
  };
}
