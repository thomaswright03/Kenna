const fs = require('node:fs');
const { test, expect, TODAY, day } = require('./fixtures');

// A 2x2 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64'
);
const photoFile = (name = 'me.png') => ({ name, mimeType: 'image/png', buffer: PNG });

async function addPhoto(page) {
  await page.locator('input[type=file]').setInputFiles(photoFile());
  await expect(page.getByRole('status').filter({ hasText: 'Photo added' })).toBeVisible();
}

test('photo viewer is an accessible dialog and deleting asks first', async ({ page, appURL }) => {
  await page.goto(`${appURL}/#/photos`);
  await addPhoto(page);
  const thumb = page.getByRole('button', { name: 'Progress photo, Thu, Sep 24' });
  await expect(thumb).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();

  await thumb.click();
  const viewer = page.getByRole('dialog', { name: 'Progress photo, Thu, Sep 24' });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole('img', { name: 'Progress photo, Thu, Sep 24' })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(thumb).toBeFocused();

  await thumb.click();
  await viewer.getByRole('button', { name: 'Delete…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete this photo from Thu, Sep 24?' });
  await expect(confirm).toContainText("can't be undone");
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  await viewer.getByRole('button', { name: 'Close' }).click();
  await expect(thumb).toBeVisible();

  await thumb.click();
  await viewer.getByRole('button', { name: 'Delete…' }).click();
  await page.getByRole('button', { name: 'Delete photo' }).click();
  await expect(page.getByText('No photos yet.')).toBeVisible();
});

test('tapping outside the photo closes the viewer', async ({ page, appURL }) => {
  await page.goto(`${appURL}/#/photos`);
  await addPhoto(page);
  await page.locator('.photo-thumb').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('files that are not photos are refused', async ({ page, appURL }) => {
  await page.goto(`${appURL}/#/photos`);
  await page.locator('input[type=file]').setInputFiles({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('hello, this is text') });
  await expect(page.getByText("That file isn't a photo we can show.")).toBeVisible();
  await expect(page.locator('.photo-thumb')).toHaveCount(0);
});

test('a backup file restores every day and photo, without duplicates on re-import', async ({ page, appURL, data, startApp, browser, backend }) => {
  await data.seed({ '2026-09-20': day('2026-09-20', { dinner: 700 }, 182), [TODAY]: day(TODAY, { breakfast: 400 }) });
  await page.clock.setFixedTime(new Date('2026-09-20T09:00:00-05:00'));
  await page.goto(`${appURL}/#/photos`);
  await addPhoto(page);
  await page.clock.setFixedTime(new Date('2026-09-24T09:00:00-05:00'));
  await page.reload();
  await addPhoto(page);
  await expect(page.locator('.photo-thumb')).toHaveCount(2);

  await page.goto(`${appURL}/#/settings`);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Backup' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('kenna-backup-2026-09-24.json');
  const file = await download.path();
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(Object.keys(backup.entries).sort()).toEqual(['2026-09-20', TODAY]);
  expect(backup.photos.map((p) => p.date).sort()).toEqual(['2026-09-20', TODAY]);
  const created = page.getByText(/Backup file created: kenna-backup-2026-09-24\.json: 2 days and 2 photos/);
  await expect(created).toBeVisible();
  await expect(created).not.toContainText('phone');
  await expect(created).toContainText(backend === 'server' ? 'somewhere other than the computer running Kenna' : 'Keep it off this device');
  await expect(page.getByText('Backup saved')).toHaveCount(0);

  // Restore into a completely empty app (fresh storage / fresh server).
  const freshURL = await startApp();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', timezoneId: 'America/Chicago' });
  const fresh = await ctx.newPage();
  await fresh.clock.setFixedTime(new Date('2026-09-24T10:00:00-05:00'));
  await fresh.goto(`${freshURL}/#/settings`);
  await fresh.locator('input[type=file]').setInputFiles(file);
  await fresh.getByRole('button', { name: 'Restore' }).click();
  await expect(fresh.getByText('Restored 2 days and 2 photos.', { exact: true })).toBeVisible();

  await fresh.goto(`${freshURL}/#/photos`);
  await expect(fresh.getByRole('button', { name: 'Progress photo, Sun, Sep 20' })).toBeVisible();
  await expect(fresh.getByRole('button', { name: 'Progress photo, Thu, Sep 24' })).toBeVisible();
  await fresh.goto(`${freshURL}/#/history`);
  await expect(fresh.locator('.history-item', { hasText: 'Sun, Sep 20' })).toContainText('700 cal · 182 lbs');

  await fresh.goto(`${freshURL}/#/settings`);
  await fresh.locator('input[type=file]').setInputFiles(file);
  await fresh.getByRole('button', { name: 'Restore' }).click();
  await expect(fresh.getByText('Restored 2 days and 0 photos. 2 photos were already here.', { exact: true })).toBeVisible();
  await fresh.goto(`${freshURL}/#/photos`);
  await expect(fresh.locator('.photo-thumb')).toHaveCount(2);
  await ctx.close();
});

test('a malformed backup is rejected and changes nothing', async ({ page, appURL, data }, testInfo) => {
  await data.seed({ '2026-09-20': day('2026-09-20', { dinner: 700 }) });
  const bad = testInfo.outputPath('bad.json');
  fs.writeFileSync(bad, JSON.stringify({ entries: { '2026-01-01': 5, garbage: { weight: 'x' } } }));
  await page.goto(`${appURL}/#/settings`);
  await page.locator('input[type=file]').setInputFiles(bad);
  await expect(page.getByRole('alert')).toContainText('Nothing was imported.');
  await page.goto(`${appURL}/#/history`);
  await expect(page.locator('.history-item')).toHaveCount(1);
  await expect(page.locator('.history-item')).toContainText('700 cal');
});

test('a photo can be filed under an earlier day and moved to another day later', async ({ page, appURL, startApp, browser }, testInfo) => {
  await page.goto(`${appURL}/#/photos`);
  const day = page.getByLabel('Day this photo was taken');
  await expect(day).toHaveValue(TODAY);
  await expect(day).toHaveAttribute('max', TODAY);
  await day.fill('2026-09-30');
  await day.dispatchEvent('change');
  await expect(page.getByText("A photo can't be filed under a day that hasn't happened yet.")).toBeVisible();
  await expect(day).toHaveValue(TODAY);

  await day.fill('2026-09-23');
  await page.locator('input[type=file]').setInputFiles(photoFile());
  await expect(page.getByRole('status').filter({ hasText: 'Photo added to Yesterday' })).toBeVisible();
  const yesterday = page.locator('.card', { has: page.getByRole('heading', { name: 'Yesterday' }) });
  await expect(yesterday.getByRole('button', { name: 'Progress photo, Wed, Sep 23' })).toBeVisible();

  // A backup made before the photo is moved.
  await page.goto(`${appURL}/#/settings`);
  const before = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Backup' }).click();
  const beforeFile = testInfo.outputPath('before.json');
  await (await before).saveAs(beforeFile);

  await page.goto(`${appURL}/#/photos`);
  await page.getByRole('button', { name: 'Progress photo, Wed, Sep 23' }).click();
  const viewer = page.getByRole('dialog');
  await viewer.getByLabel('Day this photo was taken').fill('2026-09-21');
  await viewer.getByLabel('Day this photo was taken').dispatchEvent('change');
  await expect(viewer.getByText('Moved to Mon, Sep 21')).toBeVisible();
  await expect(viewer.getByRole('heading', { name: 'Progress photo, Mon, Sep 21' })).toBeVisible();
  await viewer.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('heading', { name: 'Mon, Sep 21' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Yesterday' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Progress photo, Mon, Sep 21' })).toBeVisible();

  // Importing the older backup doesn't bring the photo back as a duplicate.
  await page.goto(`${appURL}/#/settings`);
  await page.locator('input[type=file]').setInputFiles(beforeFile);
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText(/1 photo was already here/)).toBeVisible();
  await page.goto(`${appURL}/#/photos`);
  await expect(page.locator('.photo-thumb')).toHaveCount(1);

  // A new backup carries the new day into a fresh app.
  await page.goto(`${appURL}/#/settings`);
  const after = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Backup' }).click();
  const afterFile = testInfo.outputPath('after.json');
  await (await after).saveAs(afterFile);
  const freshURL = await startApp();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', timezoneId: 'America/Chicago' });
  const fresh = await ctx.newPage();
  await fresh.clock.setFixedTime(new Date('2026-09-24T10:00:00-05:00'));
  await fresh.goto(`${freshURL}/#/settings`);
  await fresh.locator('input[type=file]').setInputFiles(afterFile);
  await fresh.getByRole('button', { name: 'Restore' }).click();
  await expect(fresh.getByText(/and 1 photo\./)).toBeVisible();
  await fresh.goto(`${freshURL}/#/photos`);
  await expect(fresh.getByRole('button', { name: 'Progress photo, Mon, Sep 21' })).toBeVisible();
  await ctx.close();
});

test('Add Photo is unavailable while a photo is being added', async ({ page, appURL }) => {
  await page.goto(`${appURL}/#/photos`);
  await expect(page.locator('label').filter({ hasText: 'Add Photo' })).toBeVisible();
  await page.evaluate(() => {
    const input = document.querySelector('input[type=file]');
    const seen = /** @type {string[]} */ ([]);
    window.__addPhotoStates = seen;
    new MutationObserver(() => {
      if (input instanceof HTMLInputElement && input.disabled) seen.push(document.querySelector(`label[for="${input.id}"]`).textContent);
    }).observe(input, { attributes: true, attributeFilter: ['disabled'] });
  });
  await addPhoto(page);
  expect(await page.evaluate(() => window.__addPhotoStates)).toContain('Adding photo…');
  await expect(page.locator('input[type=file]')).toBeEnabled();
  await expect(page.locator('label').filter({ hasText: 'Add Photo' })).not.toHaveClass(/is-disabled/);
});

test('photos saved by earlier versions, stored as a Blob, still show', async ({ page, appURL, backend, browserName }) => {
  test.skip(backend !== 'local', 'browser storage only');
  // WebKit's test browser can't put a Blob in IndexedDB at all, so a photo
  // in the old format can't exist there.
  test.skip(browserName === 'webkit', 'WebKit test contexts cannot store a Blob in IndexedDB');
  await page.goto(appURL);
  await page.evaluate(
    (b64) =>
      new Promise((resolve, reject) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const req = indexedDB.open('kenna-photos', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
        req.onsuccess = () => {
          const t = req.result.transaction('photos', 'readwrite');
          t.objectStore('photos').add({
            date: '2026-09-23',
            blob: new Blob([bytes], { type: 'image/png' }),
            createdAt: '2026-09-23T12:00:00.000Z',
          });
          t.oncomplete = () => {
            req.result.close();
            resolve();
          };
          t.onerror = () => reject(t.error);
        };
        req.onerror = () => reject(req.error);
      }),
    PNG.toString('base64')
  );
  await page.goto(`${appURL}/#/photos`);
  const thumb = page.getByRole('button', { name: 'Progress photo, Wed, Sep 23' });
  await expect(thumb).toBeVisible();
  await thumb.click();
  const img = page.getByRole('dialog').getByRole('img', { name: 'Progress photo, Wed, Sep 23' });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el) => el.naturalWidth)).toBe(2);
});

// A real 1200x900 photo-like image, drawn in the page.
async function bigPhoto(page) {
  const b64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 900;
    const g = canvas.getContext('2d');
    for (let i = 0; i < 400; i += 1) {
      g.fillStyle = `hsl(${(i * 37) % 360} 70% ${30 + (i % 40)}%)`;
      g.fillRect((i * 53) % 1200, (i * 29) % 900, 80, 60);
    }
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  });
  return Buffer.from(b64, 'base64');
}

test('the Photos grid shows small previews; the viewer shows the whole photo', async ({ page, appURL }) => {
  await page.goto(`${appURL}/#/photos`);
  const buffer = await bigPhoto(page);
  await page.locator('input[type=file]').setInputFiles({ name: 'big.jpg', mimeType: 'image/jpeg', buffer });
  await expect(page.getByRole('status').filter({ hasText: 'Photo added' })).toBeVisible();
  const gridImg = page.locator('.photo-thumb img');
  await expect.poll(() => gridImg.evaluate((el) => el.naturalWidth)).toBe(360);
  await page.reload();
  await expect.poll(() => gridImg.evaluate((el) => el.naturalWidth)).toBe(360);
  await page.locator('.photo-thumb').click();
  const full = page.getByRole('dialog').getByRole('img', { name: 'Progress photo, Thu, Sep 24' });
  await expect.poll(() => full.evaluate((el) => el.naturalWidth)).toBe(1200);
});

test('photos saved before previews existed get one the first time they are shown', async ({ page, appURL, backend }) => {
  test.skip(backend !== 'local', 'browser storage only');
  await page.goto(appURL);
  const buffer = await bigPhoto(page);
  await page.evaluate(
    (b64) =>
      new Promise((resolve, reject) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const req = indexedDB.open('kenna-photos', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
        req.onsuccess = () => {
          const t = req.result.transaction('photos', 'readwrite');
          t.objectStore('photos').add({ date: '2026-09-22', createdAt: '2026-09-22T12:00:00.000Z', bytes: bytes.buffer, type: 'image/jpeg' });
          t.oncomplete = () => {
            req.result.close();
            resolve();
          };
          t.onerror = () => reject(t.error);
        };
        req.onerror = () => reject(req.error);
      }),
    buffer.toString('base64')
  );
  await page.goto(`${appURL}/#/photos`);
  const gridImg = page.getByRole('button', { name: 'Progress photo, Tue, Sep 22' }).locator('img');
  await expect.poll(() => gridImg.evaluate((el) => el.naturalWidth)).toBe(360);
  const stored = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('kenna-photo-index', 1);
        req.onsuccess = () => {
          const get = req.result.transaction('thumbs').objectStore('thumbs').getAll();
          get.onsuccess = () => resolve(get.result.map((t) => t.bytes.byteLength));
          get.onerror = () => reject(get.error);
        };
        req.onerror = () => reject(req.error);
      })
  );
  expect(stored).toHaveLength(1);
  expect(stored[0]).toBeLessThan(buffer.length / 3);
});
