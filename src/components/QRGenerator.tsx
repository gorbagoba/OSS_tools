/**
 * QRGenerator component refactored with custom hook
 * @category components
 */

import React, { useState, useEffect } from 'react';
import { useQRGenerator } from '../hooks/useQRGenerator';
import { getStorageItem, saveQRConfig } from '../lib/storage';

// QRGenerator component
export function QRGenerator(): React.JSX.Element {
  const [text, setText] = useState<string>('https://example.com');
  const [size, setSize] = useState<number>(400);
  const [colorDark, setColorDark] = useState<string>('#000000');
  const [colorLight, setColorLight] = useState<string>('#ffffff');
  const [errorLevel, setErrorLevel] = useState<'L' | 'M' | 'Q' | 'H'>('M');

  // Use QR generator hook
  const {
    downloadQR,
    reset,
    canvasRef: qrCanvasRef,
  } = useQRGenerator({
    text,
    size,
    level: errorLevel,
    colorDark,
    colorLight,
  });

  // Use hook's canvasRef directly (remove local canvasRef since hook manages it)

  // Load defaults from storage
  useEffect(() => {
    const config = getStorageItem('qr_config', {
      defaultText: 'https://example.com',
      defaultSize: 400,
      defaultErrorLevel: 'M' as 'L' | 'M' | 'Q' | 'H',
      colorDark: '#000000',
      colorLight: '#ffffff',
    });
    setText(config.defaultText);
    setSize(config.defaultSize);
    setErrorLevel(config.defaultErrorLevel);
    setColorDark(config.colorDark);
    setColorLight(config.colorLight);
  }, []);

  // QR generation is handled by the hook's own debounced effect — a second
  // effect here caused every change to generate the QR code twice.

  const handleDownload = () => {
    downloadQR(`qrcode-${text.substring(0, 20)}.png`);
  };

  const handleClear = () => {
    setText('');
    reset();
  };

  // Update config when values change (debounced — fires once typing pauses)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveQRConfig({
        defaultText: text,
        defaultSize: size,
        defaultErrorLevel: errorLevel,
        colorDark,
        colorLight,
      });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [text, size, errorLevel, colorDark, colorLight]);

  return (
    <div className="card">
      <h1 className="text-2xl font-bold mb-4">QR Code Generator</h1>
      <p className="text-textSecondary mb-6">
        Generate high-quality QR codes instantly. All processing happens in your browser.
      </p>

      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <label className="block text-sm text-textSecondary mb-2">
            Content (URL, text, or contact info)
          </label>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Enter text, URL, or contact info..."
            className="w-full px-4 py-3 bg-input border border-border rounded-lg text-text placeholder:text-textSecondary/70 outline-none focus:border-primary transition-colors"
          />
        </div>

        <div className="bg-input border border-border rounded-xl p-8 flex justify-center items-center mb-8 min-h-[400px]">
          {text ? (
            <div className="relative">
              <canvas ref={qrCanvasRef} className="rounded-lg" />
            </div>
          ) : (
            <div className="text-textSecondary text-center">
              <p>Enter content above to generate a QR code</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div>
            <label className="block text-sm text-textSecondary mb-2">Size (px)</label>
            <input
              type="number"
              value={size}
              onChange={(e) => setSize(Math.max(50, Math.min(1000, parseInt(e.target.value) || 300)))}
              min={50}
              max={1000}
              className="w-full px-4 py-2 bg-input border border-border rounded-lg text-text outline-none focus:border-primary transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm text-textSecondary mb-2">Error Correction</label>
            <select
              value={errorLevel}
              onChange={(e) => setErrorLevel(e.target.value as 'L' | 'M' | 'Q' | 'H')}
              className="w-full px-4 py-2 bg-input border border-border rounded-lg text-text outline-none focus:border-primary transition-colors"
            >
              <option value="L">Low (7%)</option>
              <option value="M">Medium (15%)</option>
              <option value="Q">Quartile (25%)</option>
              <option value="H">High (30%)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-textSecondary mb-2">Dark Color</label>
            <input
              type="color"
              value={colorDark}
              onChange={(e) => setColorDark(e.target.value)}
              className="w-full h-10 px-2 bg-input border border-border rounded-lg cursor-pointer"
            />
          </div>

          <div>
            <label className="block text-sm text-textSecondary mb-2">Light Color</label>
            <input
              type="color"
              value={colorLight}
              onChange={(e) => setColorLight(e.target.value)}
              className="w-full h-10 px-2 bg-input border border-border rounded-lg cursor-pointer"
            />
          </div>
        </div>

        <div className="flex gap-4 justify-center">
          <button
            onClick={handleDownload}
            className="px-8 py-3 bg-primary text-black rounded-lg hover:bg-green-600 transition-colors font-medium"
          >
            Download QR Code
          </button>
          <button
            onClick={handleClear}
            className="px-8 py-3 bg-input border border-border rounded-lg hover:border-primary transition-colors font-medium"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
