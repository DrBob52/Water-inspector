import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4173);
const chromium = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

/**
 * End-to-end tests run in demo mode: the server reads fixtures, the client is built with the
 * offline map style and flat DEM, so nothing depends on any third-party host or tile server.
 * Chromium comes from PLAYWRIGHT_BROWSERS_PATH; software WebGL (SwiftShader) renders the scenes.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  outputDir: '../test-results',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 30_000,
    launchOptions: {
      executablePath: chromium,
      args: [
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--no-sandbox',
      ],
    },
  },
  webServer: {
    command: `npm run build:demo -w app && DEMO_MODE=1 PORT=${PORT} npx tsx server/src/index.ts`,
    cwd: '..',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
