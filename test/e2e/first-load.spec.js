const { test, expect } = require('./fixtures');

// Chromium's "Slow 3G" network: every request waits 2 seconds before any
// data arrives, then data arrives at about 50 KB a second.
const SLOW_3G = { offline: false, latency: 2000, downloadThroughput: 50000, uploadThroughput: 50000 };

test('a first visit on a slow 3G connection shows that Kenna is loading, then Today within seconds', async ({ page, appURL, browserName }) => {
  test.skip(browserName !== 'chromium', 'network emulation is a Chromium feature');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', SLOW_3G);

  const started = Date.now();
  await page.goto(appURL, { waitUntil: 'commit' });
  await expect(page.getByRole('status').filter({ hasText: 'Loading Kenna…' })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible({ timeout: 20000 });
  const seconds = (Date.now() - started) / 1000;
  // Within about 6 seconds.
  expect(seconds).toBeLessThan(6.5);
  await expect(page.getByText('Loading Kenna…')).toHaveCount(0);
});
