// End-to-end tests run the real UI bundle in Chromium sized like a Pixel 8 Pro
// (384 x 855 dp), with a test double of the Android host (tests/mock-server.mjs).
import { defineConfig } from '@playwright/test';

// The app runs in Berlin time (timezoneId below); the test code that checks dates must too.
process.env.TZ = 'Europe/Berlin';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  expect: { timeout: 7000 },
  fullyParallel: true,
  workers: 2,
  // On GitHub: one retry (a retried pass is reported as flaky) and failures shown as annotations.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    viewport: { width: 384, height: 855 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    timezoneId: 'Europe/Berlin',
    actionTimeout: 7000,
    launchOptions: { executablePath: process.env.NB_CHROMIUM || undefined },
  },
});
