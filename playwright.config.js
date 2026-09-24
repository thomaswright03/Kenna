// End-to-end tests of the installable app in docs/, served as GitHub Pages
// serves it, with an iPhone-sized screen: in Chromium, and in WebKit, the
// engine of Safari and of Home Screen apps on iPhone.
const fs = require('node:fs');
const { defineConfig, devices, webkit } = require('@playwright/test');

const phone = {
  ...devices['iPhone 13'],
  locale: 'en-US',
  timezoneId: 'America/Chicago',
};

// CI always runs WebKit (and fails if it's missing). Locally it runs when
// installed: npx playwright install webkit
function webkitInstalled() {
  try {
    return fs.existsSync(webkit.executablePath());
  } catch {
    return false;
  }
}
const withWebKit = !!process.env.CI || webkitInstalled();
// Said once, by the main process (workers load this file too), so a local
// run that skips WebKit doesn't look like a full run.
if (!withWebKit && !process.env.TEST_WORKER_INDEX) {
  console.warn('WebKit is not installed, so the phone-app-webkit tests are skipped. Install it with: npx playwright install webkit');
}

module.exports = defineConfig({
  testDir: 'test/e2e',
  timeout: 30000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'phone-app', use: { ...phone, browserName: 'chromium' } },
    ...(withWebKit ? [{ name: 'phone-app-webkit', use: { ...phone, browserName: 'webkit' } }] : []),
  ],
});
