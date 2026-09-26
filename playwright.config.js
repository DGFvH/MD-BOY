import { defineConfig } from '@playwright/test';

const PORT = 3123;
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;

export default defineConfig({
  testDir: 'tests',
  testMatch: /.*\.spec\.js/,
  timeout: 45_000,
  workers: 1, // the tests share one Supabase test account
  use: {
    serviceWorkers: 'block', // the PWA test allows them
    baseURL: `http://localhost:${PORT}`,
    ignoreHTTPSErrors: !!proxy,
    launchOptions: {
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      // Behind an HTTP proxy (CI sandboxes), Chromium must be told explicitly.
      ...(proxy ? { proxy: { server: proxy, bypass: 'localhost,127.0.0.1' } } : {}),
    },
  },
  webServer: {
    command: `npm run build && PORT=${PORT} node tests/serve.mjs`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
