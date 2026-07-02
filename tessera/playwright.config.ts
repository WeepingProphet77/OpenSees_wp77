import { defineConfig } from '@playwright/test';

/**
 * Playwright e2e config (build spec §3/§13). Drives the app in Chromium against
 * a production `vite preview` build (base path `/OpenSees_wp77/`) — closer to the
 * deployed app, and it avoids the dev server's transform middleware (the FEA glue
 * lives in /public and can only be loaded from a built app, not the dev server).
 * The core-design flows here exercise closed-form results (pure TS).
 *
 * The browser binary: set PW_CHROMIUM_PATH to a Chromium executable to use it
 * directly (e.g. a preinstalled browser in CI/sandbox) instead of Playwright's
 * managed download — see the note in package.json's `e2e` script.
 */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
const BASE = 'http://localhost:4173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL: BASE,
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 900 },
        launchOptions: { executablePath, args: ['--no-sandbox'] },
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: `${BASE}/OpenSees_wp77/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
