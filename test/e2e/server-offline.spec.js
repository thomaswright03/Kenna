const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect, TODAY, day } = require('./fixtures');
const { createApp } = require('../../server.js');

// This test needs the service worker the other server-version tests block.
test.use({ serviceWorkers: 'allow' });

function listen(app, port) {
  return new Promise((resolve) => {
    const server = app.listen(port, '127.0.0.1', () => resolve(server));
  });
}

test("the server version opened while its server is stopped shows Kenna's own message, and Try again works once it's back", async ({ page, backend }) => {
  test.skip(backend !== 'server', 'only the server version has a server to stop');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kenna-e2e-'));
  const app = createApp({ dataDir });
  let server = await listen(app, 0);
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;
  try {
    await page.request.post(`${url}/api/import`, { data: { entries: { [TODAY]: day(TODAY, { lunch: 650 }) } } });
    await page.goto(url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect(page.locator('.total-num')).toHaveText('650');

    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await page.reload();
    await expect(page.getByRole('heading', { name: "Couldn't load this screen" })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveText("Couldn't reach the Kenna server. Check that it's running, then try again.");
    // Nothing from the server was kept to stand in for it.
    await expect(page.locator('.total-num')).toHaveCount(0);

    server = await listen(app, port);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('.total-num')).toHaveText('650');
  } finally {
    server.closeAllConnections();
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
