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
  version: number;
  mask: number;
  generationTime: number;
  error: Error | null;
}

export function useQRGenerator(config: QRConfig) {
  const [result, setResult] = useState<QRResult>({
    data: null,
    canvas: null,
    version: 0,
    mask: 0,
    generationTime: 0,
    error: null,
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const qrDataRef = useRef<any | null>(null);

  const generateQR = useCallback(async (text: string = config.text): Promise<QRResult> => {
    if (!text.trim()) {
      return {
        data: null,
        canvas: canvasRef.current,
        version: 0,
        mask: 0,
        generationTime: 0,
        error: new Error('QR content cannot be empty'),
      };
    }

    try {
      const leanQR = await import('lean-qr');
      const { generate, correction } = leanQR;

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
        version: qr.size > 0 ? 1 : 0,
        mask: 0,
        generationTime,
        error: null,
      });

      return {
        data: qr,
        canvas: canvasRef.current,
        version: 1,
        mask: 0,
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
        version: 0,
        mask: 0,
        generationTime: 0,
        error: new Error(errorMessage),
      };
    }
  }, [config]);

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
      version: 0,
      mask: 0,
      generationTime: 0,
      error: null,
    });
    qrDataRef.current = null;
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (config.text) {
        generateQR(config.text);
      }
    }, 200);

    return () => clearTimeout(timeout);
  }, [config, generateQR]);

  return {
    ...result,
    generateQR,
    downloadQR,
    copyQR,
    reset,
    canvasRef,
  };
}

export function useQRWithPreview(config: QRConfig) {
  const {
    generateQR,
    downloadQR,
    copyQR,
    reset,
    canvasRef,
    ...rest
  } = useQRGenerator(config);

  const [previewMode, setPreviewMode] = useState<'qr' | 'text'>('qr');

  const togglePreviewMode = useCallback(() => {
    setPreviewMode((prev) => (prev === 'qr' ? 'text' : 'qr'));
  }, []);

  const updateText = useCallback((newText: string) => {
    generateQR(newText);
  }, [generateQR]);

  const updateSize = useCallback((_newSize: number) => {
    if (rest.data) {
      generateQR();
    }
  }, [generateQR, rest.data]);

  return {
    ...rest,
    downloadQR,
    copyQR,
    reset,
    canvasRef,
    previewMode,
    togglePreviewMode,
    updateText,
    updateSize,
  };
}
