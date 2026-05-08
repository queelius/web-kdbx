import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'firefox', use: { ...devices['Desktop Firefox'] } }],
  webServer: {
    // Serve from the repo root so that both /www/ (the app) and /pkg/
    // (the WASM bundle produced by wasm-pack) are reachable. app.js imports
    // '../pkg/web_kdbx.js' which resolves to /pkg/web_kdbx.js; that requires
    // the server root to be the repo root, not www/.
    command: 'cd ../.. && python3 -m http.server 8000',
    port: 8000,
    reuseExistingServer: !process.env.CI,
  },
});
