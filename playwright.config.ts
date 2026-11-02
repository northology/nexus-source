import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  // Exact on purpose: baselines are made and checked on one machine, and the workspace's 0.01 hid real changes.
  // Cost: a Playwright upgrade (new Chromium) or a Windows font-rendering update moves anti-aliasing in every
  // image at once. Do that in its own commit that regenerates the baselines, after sampling the diffs. See DESIGN.md.
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0, animations: 'disabled' } },
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1920, height: 1080 },
    timezoneId: 'America/Regina',
    locale: 'en-CA',
    colorScheme: 'light',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tests/e2e/serve-example.mjs',
    url: 'http://127.0.0.1:4499/api/builds',
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
  },
});
