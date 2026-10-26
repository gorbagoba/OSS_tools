import { defineConfig } from '@playwright/test';

/**
 * Playwright config — smoke gate (G3).
 *
 * testMatch '*.spec.ts' intentionally EXCLUDES the manual script
 * e2e/model-test.mjs (ModNet 115MB download, manual verification only —
 * not part of the automated gate).
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  timeout: 30_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5174',
  },
  webServer: {
    command: 'pnpm run dev',
    url: 'http://localhost:5174',
    reuseExistingServer: true,
    strictPort: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
