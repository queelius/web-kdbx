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
    command: 'cd ../.. && python3 -m http.server 8000 --directory www',
    port: 8000,
    reuseExistingServer: !process.env.CI,
  },
});
