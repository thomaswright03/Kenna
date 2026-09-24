const fs = require('node:fs');
const { test, expect } = require('./fixtures');

// A year of daily progress photos of about 400 KB each (a phone photo after
// the app downscales it) is a library of about 145 MB, and a backup file of
// about 195 MB (images are written as text in the file).
const PHOTOS = 365;

// Stores the photos the way every earlier version did (straight into the
// photos database, with no index or previews), so opening Photos also
// exercises building the index and making previews for older photos.
async function seedPhotos(page) {
  return page.evaluate(async (count) => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const g = canvas.getContext('2d');
    const pixels = g.createImageData(800, 600);
    for (let i = 0; i < pixels.data.length; i += 1) pixels.data[i] = i % 4 === 3 ? 255 : (i * 7919 + ((i >> 9) * 104729)) % 251;
    g.putImageData(pixels, 0, 0);
    const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    const bytes = await jpeg.arrayBuffer();
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('kenna-photos', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    for (let i = 0; i < count; i += 1) {
      const day = new Date(Date.UTC(2026, 8, 24 - i)).toISOString().slice(0, 10);
      const record = { date: day, createdAt: new Date(Date.UTC(2026, 8, 24 - i, 8)).toISOString(), bytes: bytes.slice(0), type: 'image/jpeg' };
      await new Promise((resolve, reject) => {
        const tx = db.transaction('photos', 'readwrite');
        tx.objectStore('photos').add(record);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }
    db.close();
    return bytes.byteLength * count;
  }, PHOTOS);
}

// Samples the resident memory of the browser's page (renderer) processes
// while `action` runs, and returns how far it rose above where it started.
// Unlike the JavaScript heap, this includes image bytes and ArrayBuffers
// read from storage. Garbage is collected before each sample, as a phone
// short of memory would do, so what's measured is what the page needs to
// keep, not garbage a roomy desktop browser hasn't bothered to free yet.
// Linux only (it reads /proc); elsewhere returns null.
async function rendererGrowthDuring(page, action) {
  const cdp = await page.context().browser().newBrowserCDPSession();
  const pageCdp = await page.context().newCDPSession(page);
  const rss = async () => {
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    let total = 0;
    for (const p of processInfo.filter((x) => x.type === 'renderer')) {
      const status = fs.readFileSync(`/proc/${p.id}/status`, 'utf8');
      total += Number(/VmRSS:\s+(\d+) kB/.exec(status)[1]) * 1024;
    }
    return total;
  };
  if (!fs.existsSync('/proc/self/status')) {
    await action();
    return null;
  }
  await pageCdp.send('HeapProfiler.collectGarbage');
  const start = await rss();
  let peak = start;
  let running = true;
  const sampler = (async () => {
    while (running) {
      await pageCdp.send('HeapProfiler.collectGarbage').catch(() => undefined);
      peak = Math.max(peak, await rss());
      await new Promise((r) => setTimeout(r, 50));
    }
  })();
  try {
    await action();
  } finally {
    running = false;
    await sampler;
    await cdp.detach();
    await pageCdp.detach();
  }
  return peak - start;
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

test('a year of photos opens, backs up and restores a photo at a time', async ({ page, appURL, startApp, browser, browserName }, testInfo) => {
  test.setTimeout(300000);
  const measure = browserName === 'chromium' ? rendererGrowthDuring : async (_p, action) => (await action(), null);
  await page.goto(`${appURL}/#/settings`);
  const library = await seedPhotos(page);
  expect(library).toBeGreaterThan(PHOTOS * 350 * 1024);

  // Photos: the grid lists every photo and loads small previews of the ones on screen.
  await page.goto(`${appURL}/#/`);
  await page.reload();
  const photosGrowth = await measure(page, async () => {
    await page.goto(`${appURL}/#/photos`);
    await expect(page.locator('.photo-thumb')).toHaveCount(PHOTOS, { timeout: 60000 });
    await expect.poll(() => page.locator('.photo-thumb img').first().evaluate((el) => el.naturalWidth), { timeout: 30000 }).toBe(360);
  });
  const loadedPreviews = await page.locator('.photo-thumb img').count();
  expect(loadedPreviews).toBeLessThan(60);

  let file;
  await page.goto(`${appURL}/#/settings`);
  await expect(page.getByRole('button', { name: 'Export Backup' })).toBeVisible();
  const exportGrowth = await measure(page, async () => {
    const downloadPromise = page.waitForEvent('download', { timeout: 180000 });
    await page.getByRole('button', { name: 'Export Backup' }).click();
    const download = await downloadPromise;
    file = testInfo.outputPath('year.json');
    await download.saveAs(file);
    await expect(page.getByText(/Backup file created: .*, with 365 photos and no days/)).toBeVisible({ timeout: 60000 });
  });
  const size = fs.statSync(file).size;
  expect(size).toBeGreaterThan(library);

  const freshURL = await startApp();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', timezoneId: 'America/Chicago' });
  const fresh = await ctx.newPage();
  await fresh.clock.setFixedTime(new Date('2026-09-24T10:00:00-05:00'));
  await fresh.goto(`${freshURL}/#/settings`);
  const importGrowth = await measure(fresh, async () => {
    await fresh.locator('input[type=file]').setInputFiles(file);
    await expect(fresh.getByRole('dialog')).toContainText('365 photos', { timeout: 60000 });
    await fresh.getByRole('button', { name: 'Restore' }).click();
    await expect(fresh.getByText('Restored 365 photos.', { exact: true })).toBeVisible({ timeout: 180000 });
  });
  expect(await countPhotos(fresh)).toBe(PHOTOS);

  await fresh.locator('input[type=file]').setInputFiles(file);
  const notice = fresh.getByRole('dialog', { name: 'Nothing to restore' });
  await expect(notice).toContainText('It has 365 photos and no days', { timeout: 60000 });
  await expect(notice).toContainText('Everything in it is already on this device');
  await notice.getByRole('button', { name: 'Close' }).click();
  expect(await countPhotos(fresh)).toBe(PHOTOS);
  await ctx.close();

  const mb = (n) => (n === null ? 'n/a' : `${Math.round(n / 1e6)} MB`);
  const report = `library ${mb(library)}, file ${mb(size)}; page process memory rose by: Photos ${mb(photosGrowth)}, export ${mb(exportGrowth)}, import ${mb(importGrowth)}`;
  testInfo.annotations.push({ type: 'memory', description: report });
  console.log(report);
  // The page never holds the library (or the backup file) in its own
  // memory. (Reading every photo at once, as earlier versions did, grew it
  // by about the size of the library.)
  for (const growth of [photosGrowth, exportGrowth, importGrowth]) {
    if (growth !== null) expect(growth).toBeLessThan(library / 3);
  }
});
