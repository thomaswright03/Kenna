const { test, expect, TODAY, day } = require('./fixtures');

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
    await page.route('**/api/entries', () => {
      // never answers
    });
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'History' }).click();
    await page.clock.runFor(10500);
    await expect(page.getByText("The Kenna server isn't responding. Check it's running, then try again.")).toBeVisible();
    await page.unroute('**/api/entries');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  });

  test('a save that times out keeps the typed value and can be retried', async ({ page, appURL, data }) => {
    await page.clock.install({ time: new Date('2026-09-24T10:00:00-05:00') });
    await page.goto(appURL);
    await page.route('**/api/entries/*', (route) => (route.request().method() === 'PATCH' ? undefined : route.continue()));
    await page.getByLabel('Weight (lbs)').fill('180');
    await page.getByLabel('Weight (lbs)').blur();
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
      navigator.storage.persisted = async () => false;
      navigator.storage.persist = async () => {
        window.__persistCalls += 1;
        return true;
      };
    });
    await page.goto(appURL);
    await expect.poll(() => page.evaluate(() => window.__persistCalls)).toBe(1);
  });

  test('opens offline after the first visit', async ({ page, appURL, context }) => {
    await page.goto(appURL);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await context.setOffline(false);
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
});
