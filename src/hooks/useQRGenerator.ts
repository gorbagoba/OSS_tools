/**
 * Custom hook for QR code generation
 * @category hooks
 */

import {
  useState, useCallback, useRef, useEffect,
} from 'react';

export interface QRConfig {
  text: string;
  size: number;
  level: 'L' | 'M' | 'Q' | 'H';
  colorDark: string;
  colorLight: string;
}

// Helper to convert hex color to RGBA array for lean-qr
function hexToRgba(hex: string): [number, number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h.split('').map((c: string) => c + c).join('');
  }
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return [r, g, b, 255];
}

export interface QRResult {
  data: any | null;
  canvas: HTMLCanvasElement | null;
  generationTime: number;
  error: Error | null;
}

// Module-level memoized dynamic import: lean-qr is fetched once, later
// generations skip the import machinery entirely (was: await import() on
// every keystroke's generation).
let leanQrPromise: Promise<typeof import('lean-qr')> | null = null;
function loadLeanQR(): Promise<typeof import('lean-qr')> {
  if (!leanQrPromise) {
    leanQrPromise = import('lean-qr');
  }
  return leanQrPromise;
}

export function useQRGenerator(config: QRConfig) {
  const [result, setResult] = useState<QRResult>({
    data: null,
    canvas: null,
    generationTime: 0,
    error: null,
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const qrDataRef = useRef<any | null>(null);
  const textRef = useRef(config.text);
  textRef.current = config.text;

  const generateQR = useCallback(async (input?: string): Promise<QRResult> => {
    const text = input ?? textRef.current;
    if (!text.trim()) {
      return {
        data: null,
        canvas: canvasRef.current,
        generationTime: 0,
        error: new Error('QR content cannot be empty'),
      };
    }

    try {
      const { generate, correction } = await loadLeanQR();

      const startTime = performance.now();

      // Use leanQR.correction values for correct type
      const qr = generate(text, { minCorrectionLevel: correction[config.level] });
      qrDataRef.current = qr;

      if (canvasRef.current) {
        // High DPI rendering: scale canvas for sharp QR on high-res displays
        const dpr = window.devicePixelRatio || 1;
        canvasRef.current.width = config.size * dpr;
        canvasRef.current.height = config.size * dpr;

        // Use lean-qr's on/off options with RGBA arrays
        qr.toCanvas(canvasRef.current, {
          on: hexToRgba(config.colorDark),
          off: hexToRgba(config.colorLight),
          padX: 2,
          padY: 2,
        });

        // Scale canvas via CSS to display at requested size
        canvasRef.current.style.width = `${config.size}px`;
        canvasRef.current.style.height = `${config.size}px`;
        canvasRef.current.style.imageRendering = 'pixelated';
      }

      const generationTime = performance.now() - startTime;

      setResult({
        data: qr,
        canvas: canvasRef.current,
        generationTime,
        error: null,
      });

      return {
        data: qr,
        canvas: canvasRef.current,
        generationTime,
        error: null,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate QR code';

      setResult((prev) => ({
        ...prev,
        error: new Error(errorMessage),
        generationTime: 0,
      }));

      return {
        data: null,
        canvas: canvasRef.current,
        generationTime: 0,
        error: new Error(errorMessage),
      };
    }
    // Primitive deps only: config object identity changes every render, which
    // previously re-created generateQR (and re-fired effects) on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.size, config.level, config.colorDark, config.colorLight]);

  const downloadQR = useCallback((filename: string = 'qrcode.png'): boolean => {
    if (!result.canvas || !qrDataRef.current) {
      return false;
    }

    try {
      const link = document.createElement('a');
      link.download = filename;
      link.href = result.canvas.toDataURL('image/png');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return true;
    } catch {
      return false;
    }
  }, [result.canvas]);

  const copyQR = useCallback(async (): Promise<boolean> => {
    if (!result.canvas || !qrDataRef.current) {
      return false;
    }

    try {
      const blob = await new Promise<Blob | null>((resolve) => {
        result.canvas!.toBlob((blob) => resolve(blob), 'image/png');
      });

      if (blob) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob }),
        ]);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [result.canvas]);

  const reset = useCallback(() => {
    setResult({
      data: null,
      canvas: null,
      generationTime: 0,
      error: null,
    });
    qrDataRef.current = null;
  }, []);

  // Single debounced generation point. Keyed on primitives so a parent
  // re-render with a fresh config object literal does not re-trigger it.
  const {
    text, size, level, colorDark, colorLight,
  } = config;
  useEffect(() => {
    if (!text.trim()) return undefined;
    const timeout = setTimeout(() => {
      void generateQR(text);
    }, 200);

    return () => clearTimeout(timeout);
  }, [text, size, level, colorDark, colorLight, generateQR]);

  return {
    ...result,
    generateQR,
    downloadQR,
    copyQR,
    reset,
    canvasRef,
  };
}
