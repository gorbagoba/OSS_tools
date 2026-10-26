/**
 * Lightweight toast notifications: fixed bottom-right stack, auto-dismiss.
 * `useToast().show(message, variant)` from any component under the provider.
 * @category components
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import type { ReactNode } from 'react';

type ToastVariant = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  leaving: boolean;
}

interface ToastContextValue {
  show: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue>({ show: () => {} });

const TOAST_MS = 2600;
const LEAVE_MS = 250;

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: 'border-green-500/40 bg-green-500/10 text-text',
  error: 'border-red-500/40 bg-red-500/10 text-text',
  info: 'border-primary/40 bg-primary/10 text-text',
};

const VARIANT_ICONS: Record<ToastVariant, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((message: string, variant: ToastVariant = 'success') => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((prev) => [...prev.slice(-2), {
      id, message, variant, leaving: false,
    }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)));
      window.setTimeout(() => remove(id), LEAVE_MS);
    }, TOAST_MS);
  }, [remove]);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 items-end"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <ToastRow key={toast.id} toast={toast} onDismiss={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastRow({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  // Two-phase mount: start hidden, then reveal, so the CSS transition runs.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const raf = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      className={`pointer-events-auto flex items-center gap-2 rounded-lg border px-4 py-2.5 shadow-lg backdrop-blur transition-all duration-200 ${VARIANT_STYLES[toast.variant]} ${
        visible && !toast.leaving ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      }`}
    >
      <span aria-hidden="true" className="font-semibold">{VARIANT_ICONS[toast.variant]}</span>
      <span className="text-sm">{toast.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="ml-2 text-textSecondary hover:text-text"
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
