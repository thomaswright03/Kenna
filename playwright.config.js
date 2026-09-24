// End-to-end tests. Each spec runs twice: against the installable app in
// docs/ (browser storage) and against server.js (server storage).
const { defineConfig, devices } = require('@playwright/test');

const phone = {
  ...devices['iPhone 13'],
  browserName: 'chromium',
  locale: 'en-US',
  timezoneId: 'America/Chicago',
};

module.exports = defineConfig({
  testDir: 'test/e2e',
  timeout: 30000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'phone-app', use: { ...phone, backend: 'local' } },
    { name: 'server-app', use: { ...phone, backend: 'server' } },
  ],
});
