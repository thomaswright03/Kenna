const fs = require('node:fs');
const { test, expect } = require('./fixtures');

// A year of daily progress photos at the size the app stores them (about
// 300 KB each after downscaling) makes a backup file of about 145 MB.
const PHOTOS = 365;
const PHOTO_BYTES = 300 * 1024;

async function seedPhotos(page) {
  await page.evaluate(
    async ([count, size]) => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('kenna-photos', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      for (let i = 0; i < count; i += 1) {
        const bytes = new Uint8Array(size);
        for (let b = 0; b < size; b += 1) bytes[b] = (b * 31 + i) & 255;
        bytes.set([0xff, 0xd8, 0xff, 0xe0]);
        const day = new Date(Date.UTC(2026, 8, 24 - i)).toISOString().slice(0, 10);
        const record = { date: day, createdAt: new Date(Date.UTC(2026, 8, 24 - i, 8)).toISOString(), bytes: bytes.buffer, type: 'image/jpeg' };
        await new Promise((resolve, reject) => {
          const tx = db.transaction('photos', 'readwrite');
          tx.objectStore('photos').add(record);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
      }
      db.close();
    },
    [PHOTOS, PHOTO_BYTES]
  );
}

// Samples the page's JavaScript heap while `action` runs; returns the peak.
async function peakHeapDuring(page, action) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  let peak = 0;
  let running = true;
  const sampler = (async () => {
    while (running) {
      const { metrics } = await cdp.send('Performance.getMetrics');
      const used = metrics.find((m) => m.name === 'JSHeapUsedSize').value;
      peak = Math.max(peak, used);
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
  try {
    await action();
  } finally {
    running = false;
    await sampler;
  }
  return peak;
}

const countPhotos = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('kenna-photos', 1);
        req.onsuccess = () => {
          const count = req.result.transaction('photos').objectStore('photos').count();
          count.onsuccess = () => resolve(count.result);
          count.onerror = () => reject(count.error);
        };
        req.onerror = () => reject(req.error);
      })
  );

test('a year of photos backs up and restores a photo at a time', async ({ page, appURL, startApp, browser, backend, browserName }, testInfo) => {
  test.skip(backend !== 'local', 'the phone app is where memory is tight');
  test.setTimeout(240000);
  await page.goto(`${appURL}/#/settings`);
  await seedPhotos(page);
  await page.reload();

  let file;
  const exportRun = async () => {
    const downloadPromise = page.waitForEvent('download', { timeout: 180000 });
    await page.getByRole('button', { name: 'Export Backup' }).click();
    const download = await downloadPromise;
    file = testInfo.outputPath('year.json');
    await download.saveAs(file);
    await expect(page.getByText(/Backup file created: .*: 0 days and 365 photos/)).toBeVisible({ timeout: 60000 });
  };
  const exportPeak = browserName === 'chromium' ? await peakHeapDuring(page, exportRun) : (await exportRun(), 0);
  const size = fs.statSync(file).size;
  expect(size).toBeGreaterThan(PHOTOS * PHOTO_BYTES);

  const freshURL = await startApp();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', timezoneId: 'America/Chicago' });
  const fresh = await ctx.newPage();
  await fresh.clock.setFixedTime(new Date('2026-09-24T10:00:00-05:00'));
  await fresh.goto(`${freshURL}/#/settings`);
  const importRun = async () => {
    await fresh.locator('input[type=file]').setInputFiles(file);
    await expect(fresh.getByRole('dialog')).toContainText('365 photos', { timeout: 60000 });
    await fresh.getByRole('button', { name: 'Restore' }).click();
    await expect(fresh.getByText('Restored 0 days and 365 photos.', { exact: true })).toBeVisible({ timeout: 180000 });
  };
  const importPeak = browserName === 'chromium' ? await peakHeapDuring(fresh, importRun) : (await importRun(), 0);
  expect(await countPhotos(fresh)).toBe(PHOTOS);

  await fresh.locator('input[type=file]').setInputFiles(file);
  await fresh.getByRole('button', { name: 'Restore' }).click();
  await expect(fresh.getByText('Restored 0 days and 0 photos. 365 photos were already here.', { exact: true })).toBeVisible({ timeout: 180000 });
  expect(await countPhotos(fresh)).toBe(PHOTOS);
  await ctx.close();

  testInfo.annotations.push({ type: 'memory', description: `file ${Math.round(size / 1e6)} MB, peak JS heap export ${Math.round(exportPeak / 1e6)} MB, import ${Math.round(importPeak / 1e6)} MB` });
  console.log(`file ${Math.round(size / 1e6)} MB, peak JS heap export ${Math.round(exportPeak / 1e6)} MB, import ${Math.round(importPeak / 1e6)} MB`);
  if (browserName === 'chromium') {
    // The whole file never sits in the page's memory at once.
    expect(exportPeak).toBeLessThan(size / 4);
    expect(importPeak).toBeLessThan(size / 4);
  }
});
