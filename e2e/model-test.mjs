/**
 * Model config diagnostic — tests one model config in a real browser.
 * Usage: node e2e/model-test.mjs <model> [dtype] [device] [wasmSuffix]
 * Example: node e2e/model-test.mjs onnx-community/BiRefNet_lite-ONNX fp32 wasm ''
 * Uses a persistent profile (e2e/.browser-profile) so HF model cache is reused between runs.
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = path.join(ROOT, 'e2e', `.browser-profile-${Date.now()}`);

const [model, dtype = 'fp32', device = '', wasmSuffix = null] = process.argv.slice(2);
if (!model) {
  console.error('usage: node e2e/model-test.mjs <model> [dtype] [device] [wasmSuffix]');
  process.exit(2);
}

const port = 5199;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true,
});
let serverOut = '';
server.stdout?.on('data', (d) => (serverOut += String(d)));
server.stderr?.on('data', (d) => (serverOut += String(d)));

async function waitForServer(timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/`);
      if (res.ok) return;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`dev server did not start:\n${serverOut}`);
}

const qs = new URLSearchParams({ model, dtype, wasm: wasmSuffix ?? '' });
if (device) qs.set('device', device);
const url = `http://localhost:${port}/e2e/model-test.html?${qs}`;

try {
  await waitForServer();
const context = await chromium.launchPersistentContext(PROFILE, {
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=WebGPU'],
});
  const page = await context.newPage();
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.startsWith('RESULT') || t.startsWith('wasm build') || t.includes('webgpu adapter')) {
      // already captured from page log
    }
  });
  const pageLog = [];
  page.on('console', (msg) => pageLog.push(`[${msg.type()}] ${msg.text()}`));

  console.log(`URL: ${url}`);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(
    () => document.getElementById('log').textContent.includes('RESULT:'),
    null,
    { timeout: 20 * 60 * 1000, polling: 1000 },
  );
  const text = await page.evaluate(() => document.getElementById('log').textContent);
  console.log('--- page log ---');
  console.log(text);
  // Dump interesting console errors
  const errs = pageLog.filter((l) => l.startsWith('[error]')).slice(-5);
  if (errs.length) {
    console.log('--- console errors ---');
    console.log(errs.join('\n'));
  }
  await context.close();
  process.exit(text.includes('RESULT: SUCCESS') ? 0 : 1);
} catch (e) {
  console.error('DRIVER FAIL:', e.message);
  console.error(serverOut.slice(-2000));
  process.exit(1);
} finally {
  server.kill();
}
