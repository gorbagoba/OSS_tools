import React, {
  createContext, useContext, useEffect, useCallback, useRef, useMemo,
} from 'react';

interface A11yContextType {
  announce: (message: string, priority?: 'high' | 'low') => void;
  isProcessing: boolean;
  setIsProcessing: (processing: boolean) => void;
}

const A11yContext = createContext<A11yContextType>({
  announce: () => {},
  isProcessing: false,
  setIsProcessing: () => {},
});

interface A11yProviderProps {
  children: React.ReactNode;
}

// A11yProvider component with a11y features
export function A11yProvider({ children }: A11yProviderProps): React.JSX.Element {
  const regionRef = useRef<HTMLDivElement>(null);
  const wasProcessing = useRef(false);
  const [isProcessing, setIsProcessing] = React.useState(false);

  const announce = useCallback((message: string, priority: 'high' | 'low' = 'low') => {
    if (!regionRef.current) return;

    const politeness = priority === 'high' ? 'assertive' : 'polite';
    regionRef.current.setAttribute('aria-live', politeness);
    regionRef.current.setAttribute('aria-atomic', 'true');
    regionRef.current.setAttribute('role', 'status');

    regionRef.current.textContent = '';

    setTimeout(() => {
      regionRef.current!.textContent = message;
    }, 50);
  }, []);

  // Announce processing state changes. StrictMode-safe: only real
  // transitions announce (nothing is announced at mount, and the
  // double-invoked dev effect sees the same state twice).
  useEffect(() => {
    if (isProcessing) {
      wasProcessing.current = true;
      announce('Processing started. Please wait.', 'low');
    } else if (wasProcessing.current) {
      wasProcessing.current = false;
      announce('Processing complete.', 'low');
    }
  }, [isProcessing, announce]);

  return (
    <A11yContext.Provider
      value={useMemo(
        () => ({ announce, isProcessing, setIsProcessing }),
        [announce, isProcessing, setIsProcessing],
      )}
    >
      {children}
      <div
        ref={regionRef}
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        role="status"
      />
    </A11yContext.Provider>
  );
}

export const useA11y = () => useContext(A11yContext);
