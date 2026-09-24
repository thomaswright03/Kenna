const { test, expect, TODAY, day } = require('./fixtures');
const { createStaticServer } = require('../../scripts/serve-docs.js');

// The phone app's files, served normally until `stall` is set, after which
// requests are left hanging, as on a very weak signal.
async function stallableServer() {
  const inner = createStaticServer().listeners('request')[0];
  const held = [];
  const control = { stall: false, held: 0, served: 0 };
  // Answers the requests left hanging, as when the signal comes back.
  control.release = () => {
    control.stall = false;
    for (const [req, res] of held.splice(0)) inner(req, res);
  };
  const server = require('node:http').createServer((req, res) => {
    if (control.stall) {
      control.held += 1;
      held.push([req, res]);
    } else {
      control.served += 1;
      inner(req, res);
    }
  });
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  control.url = `http://127.0.0.1:${server.address().port}`;
  control.close = () => {
    for (const socket of sockets) socket.destroy();
    server.close();
  };
  return control;
}

test.describe('server version', () => {
  test.beforeEach(({ backend }) => test.skip(backend !== 'server', 'server-only behaviour'));

  test('a failed save says so and can be retried', async ({ page, appURL, data }) => {
    await page.goto(appURL);
    await page.route('**/api/entries/*', (route) => (route.request().method() === 'PATCH' ? route.abort() : route.continue()));
    await page.getByLabel('Weight (lbs)').fill('180');
    await page.getByLabel('Weight (lbs)').blur();
    await expect(page.getByText("Couldn't reach the Kenna server. Check that it's running, then try again.")).toBeVisible();
    expect((await data.entry(TODAY)).weight).toBe(null);
    await page.unroute('**/api/entries/*');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    expect((await data.entry(TODAY)).weight).toBe(180);
  });

  test('a failed load shows an error instead of an empty day that could overwrite data', async ({ page, appURL, data }) => {
    await data.seed({ [TODAY]: day(TODAY, { breakfast: 400 }) });
    await page.route('**/api/entries/**', (route) => route.abort());
    await page.goto(appURL);
    await expect(page.getByRole('heading', { name: "Couldn't load this screen" })).toBeVisible();
    await expect(page.getByLabel('Weight (lbs)')).toHaveCount(0);
    await page.unroute('**/api/entries/**');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('.total-num')).toHaveText('400');
  });

  test('switching screens discards slow results from the previous screen', async ({ page, appURL }) => {
    await page.goto(appURL);
    let delayed = false;
    await page.route('**/api/entries', async (route) => {
      if (!delayed) {
        delayed = true;
        await new Promise((r) => setTimeout(r, 1500));
      }
      await route.continue();
    });
    const nav = page.getByRole('navigation', { name: 'Main' });
    await nav.getByRole('link', { name: 'History' }).click();
    await nav.getByRole('link', { name: 'Compare' }).click();
    await expect(page.getByRole('heading', { name: 'Compare' })).toBeVisible();
    await page.waitForTimeout(2000);
    await expect(page.getByRole('heading', { name: 'History' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Compare' })).toBeVisible();
  });

  test('a slow screen shows a loading indicator and the old screen cannot be used meanwhile', async ({ page, appURL }) => {
    await page.goto(appURL);
    await expect(page.getByLabel('Weight (lbs)')).toBeVisible();
    await page.route('**/api/**', async (route) => {
      await new Promise((r) => setTimeout(r, 4000));
      await route.continue().catch(() => {});
    });
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'History' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Loading…' })).toBeVisible();
    await expect(page.locator('#main')).toHaveAttribute('inert', '');
    const focused = await page.getByLabel('Weight (lbs)').evaluate((el) => {
      el.focus();
      return document.activeElement === el;
    });
    expect(focused).toBe(false);
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('status').filter({ hasText: 'Loading…' })).toBeHidden();
    await expect(page.locator('#main')).not.toHaveAttribute('inert', '');
  });

  test('a server that never answers times out with a message and Try again', async ({ page, appURL }) => {
    await page.clock.install({ time: new Date('2026-09-24T10:00:00-05:00') });
    await page.goto(appURL);
    await expect(page.getByLabel('Weight (lbs)')).toBeVisible();
    let requested;
    const hung = new Promise((resolve) => { requested = resolve; });
    await page.route('**/api/entries', () => {
      // never answers
      requested();
    });
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'History' }).click();
    // Advance the clock only once the request (and its timeout timer) exists.
    await hung;
    await page.clock.runFor(10500);
    await expect(page.getByText("The Kenna server isn't responding. Check it's running, then try again.")).toBeVisible();
    await page.unroute('**/api/entries');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  });

  test('a save that times out keeps the typed value and can be retried', async ({ page, appURL, data }) => {
    await page.clock.install({ time: new Date('2026-09-24T10:00:00-05:00') });
    await page.goto(appURL);
    let patched;
    const hung = new Promise((resolve) => { patched = resolve; });
    await page.route('**/api/entries/*', (route) => (route.request().method() === 'PATCH' ? patched() : route.continue()));
    await page.getByLabel('Weight (lbs)').fill('180');
    await page.getByLabel('Weight (lbs)').blur();
    await hung;
    await page.clock.runFor(10500);
    await expect(page.getByText("The Kenna server isn't responding. Check it's running, then try again.")).toBeVisible();
    await expect(page.getByLabel('Weight (lbs)')).toHaveValue('180');
    await page.unroute('**/api/entries/*');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    expect((await data.entry(TODAY)).weight).toBe(180);
  });

  test('a server error is explained without a status code', async ({ page, appURL }) => {
    await page.goto(appURL);
    await page.route('**/api/entries/*', (route) =>
      route.request().method() === 'PATCH' ? route.fulfill({ status: 500, body: 'Internal Server Error' }) : route.continue()
    );
    await page.getByLabel('Weight (lbs)').fill('180');
    await page.getByLabel('Weight (lbs)').blur();
    const message = page.locator('.field-status.is-error');
    await expect(message).toContainText('The Kenna server ran into a problem. Try again, and if it keeps happening, restart the server.');
    await expect(message).not.toContainText('500');
  });
});

test.describe('phone version', () => {
  test.beforeEach(({ backend }) => test.skip(backend !== 'local', 'phone-only behaviour'));

  test('two tabs editing the same day keep both meals', async ({ page, appURL, context, data }) => {
    await page.goto(`${appURL}/#/log/breakfast`);
    const other = await context.newPage();
    await other.clock.setFixedTime(new Date('2026-09-24T10:00:00-05:00'));
    await other.goto(`${appURL}/#/log/lunch`);
    await page.getByLabel('Breakfast calories').fill('400');
    await page.getByLabel('Breakfast calories').blur();
    await expect(other.locator('[data-meal="breakfast"]')).toContainText('400');
    await other.getByLabel('Lunch calories').fill('650');
    await other.getByLabel('Lunch calories').blur();
    const saved = await data.entry(TODAY);
    expect(saved.meals).toMatchObject({ breakfast: 400, lunch: 650 });
  });

  test('damaged storage is recovered with an in-app message, not a pop-up', async ({ page, appURL }) => {
    await page.goto(appURL);
    await page.evaluate(() => {
      localStorage.setItem('kenna:entries:backup', JSON.stringify({ '2026-09-20': { date: '2026-09-20', weight: 181, meals: {} } }));
      localStorage.setItem('kenna:entries', '{oops');
    });
    await page.reload();
    await expect(page.getByRole('status').filter({ hasText: 'restored it from its automatic copy' })).toBeVisible();
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'History' }).click();
    await expect(page.locator('.history-item')).toContainText('181 lbs');
  });

  test('asks the browser to keep data persistently on launch', async ({ page, appURL }) => {
    await page.addInitScript(() => {
      window.__persistCalls = 0;
      if (!navigator.storage || !navigator.storage.persist) return;
      navigator.storage.persisted = async () => false;
      navigator.storage.persist = async () => {
        window.__persistCalls += 1;
        return true;
      };
    });
    await page.goto(appURL);
    const supported = await page.evaluate(() => !!(navigator.storage && navigator.storage.persist));
    test.skip(!supported, 'this browser has no way to ask for persistent storage');
    await expect.poll(() => page.evaluate(() => window.__persistCalls)).toBe(1);
  });

  // The site going away entirely stands in for airplane mode: WebKit's
  // offline emulation fails navigations before the service worker sees them.
  test('opens offline after the first visit', async ({ page }) => {
    const site = await stallableServer();
    await page.goto(site.url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    site.close();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  });

  test('on a stalled connection it opens from its offline copy within a few seconds', async ({ page }) => {
    const site = await stallableServer();
    try {
      await page.goto(site.url);
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();

      site.stall = true;
      const started = Date.now();
      await page.reload({ timeout: 10000 });
      await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible({ timeout: 10000 });
      expect(Date.now() - started).toBeLessThan(6000);
      expect(site.held).toBeGreaterThan(0);

      // Once the connection is back, the network is used again.
      site.release();
      site.served = 0;
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
      expect(site.served).toBeGreaterThan(0);
    } finally {
      site.close();
    }
  });

  test('blocked storage explains what to do', async ({ page, appURL }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new Error('blocked');
      };
    });
    await page.goto(appURL);
    await expect(page.getByRole('heading', { name: 'Storage is blocked here' })).toBeVisible();
  });

  test("photo storage that won't open is explained in Kenna's words, not the browser's", async ({ page, appURL }) => {
    await page.addInitScript(() => {
      IDBFactory.prototype.open = function () {
        const req = {};
        setTimeout(() => {
          Object.defineProperty(req, 'error', { value: new DOMException('Internal error opening backing store for indexedDB.open.', 'UnknownError') });
          if (typeof req.onerror === 'function') req.onerror(new Event('error'));
        }, 10);
        return /** @type {IDBOpenDBRequest} */ (/** @type {unknown} */ (req));
      };
    });
    await page.goto(`${appURL}/#/photos`);
    const alert = page.getByRole('alert');
    await expect(alert).toContainText("Kenna couldn't open its photo storage on this device. Nothing has been deleted");
    await expect(alert).toContainText('Close Kenna completely, open it again');
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/indexedDB|backing store/i);
    // The rest of the app still works.
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Today' }).click();
    await expect(page.getByLabel('Weight (lbs)')).toBeVisible();
  });

  test('a photo that runs out of room says to free space, in plain words', async ({ page, appURL }) => {
    await page.addInitScript(() => {
      IDBObjectStore.prototype.add = function () {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      };
    });
    await page.goto(`${appURL}/#/photos`);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
    await page.locator('input[type=file]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
    const status = page.locator('.field-status.is-error');
    await expect(status).toContainText("Photo not saved. There's no room left for Kenna's photos on this device.");
    await expect(status).toContainText('Delete some old progress photos or free up space on the phone');
    await expect(status).not.toContainText('quota');
  });

  test('a day that runs out of room says what to do next', async ({ page, appURL }) => {
    await page.goto(appURL);
    await page.evaluate(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'kenna:entries') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return setItem.call(this, key, value);
      };
    });
    await page.getByLabel('Weight (lbs)').fill('180');
    await page.getByLabel('Weight (lbs)').press('Enter');
    const status = page.locator('.field-status.is-error');
    await expect(status).toContainText("Not saved. There's no room left for Kenna's data on this device. Everything saved before is safe.");
    await expect(status).toContainText('Export a backup (Settings), then delete some old progress photos or free up space on the phone');
    await expect(status.getByRole('button', { name: 'Retry' })).toBeVisible();
  });
});
