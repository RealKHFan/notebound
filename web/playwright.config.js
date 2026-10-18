// End-to-end tests run the real UI bundle in Chromium sized like a Pixel 8 Pro
// (384 x 855 dp), with a test double of the Android host (tests/mock-server.mjs).
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  expect: { timeout: 7000 },
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: [['list']],
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
