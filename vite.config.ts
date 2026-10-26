import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';

/**
 * Cross-origin isolation (COOP/COEP) is required for SharedArrayBuffer, which
 * enables multi-threaded WASM inference in onnxruntime-web (ort.env.wasm.numThreads)
 * and wasm-bindgen rayon threads. All cross-origin resources in this app are
 * CORS-mode fetches (HuggingFace models), which remain permitted under require-corp.
 */
const CROSS_ORIGIN_ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react(), wasm()],
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
    // es2022: top-level await in the wasm-initialized worker bundle.
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Chunk transformers (heavy ML model)
          if (id.includes('@huggingface/transformers')) {
            return 'transformers';
          }
          // pdfjs-dist is imported directly and chunks fine on its own;
          // only transformers (heavy ML model) needs a manual chunk.
          return null;
        },
      },
    },
    // Disable chunk size warning - pdfjs-dist worker is large but necessary
    chunkSizeWarningLimit: 3000,
  },
  server: {
    port: 5174,
    open: true,
    headers: CROSS_ORIGIN_ISOLATION_HEADERS,
  },
  preview: {
    // Distinct from the dev port: sharing 5174 caused stale prod tabs to hit
    // the dev server (hashed /assets/*.mjs URLs -> SPA HTML fallback ->
    // "Setting up fake worker failed" pdf.js errors).
    port: 4174,
    strictPort: true,
    headers: CROSS_ORIGIN_ISOLATION_HEADERS,
  },
  // ES-format workers: wasm-bindgen bundler glue relies on import.meta.url.
  // vite-plugin-wasm must be added to worker builds explicitly (Vite 5.1+).
  worker: {
    format: 'es',
    plugins: () => [wasm()],
  },
  optimizeDeps: {
    // pdfjs-dist: worker loads via ?url — prebundle breaks workerSrc.
    // onnxruntime-web: prebundle breaks import.meta.url resolution of its
    // .wasm binaries (dev serves an HTML fallback -> instantiate fails).
    exclude: ['pdfjs-dist', 'onnxruntime-web'],
  },
});
