const { test, expect, TODAY } = require('./fixtures');

/** Makes the next saves of days fail, as when the phone's storage is full. */
async function breakSaving(page) {
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'kenna:entries' || key === 'kenna:entries:recent') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  });
}

test('Settings says when nothing has gone wrong', async ({ page, appURL }) => {
  await page.goto(`${appURL}/#/settings`);
  const card = page.locator('[data-problem-log]');
  await expect(card).toContainText('Nothing has gone wrong on this device.');
  await expect(card).toContainText('never your weights, meals or photos');
  await expect(card.getByRole('button', { name: 'Copy log' })).toHaveCount(0);
});

test('a failed save is noted in the problem log, which Settings shows, copies and clears', async ({ page, appURL, data }) => {
  await page.goto(appURL);
  await breakSaving(page);
  await page.getByLabel('Weight (lbs)').fill('181.4');
  await page.getByLabel('Weight (lbs)').press('Enter');
  await expect(page.locator('.field-status.is-error')).toBeVisible();
  // Retrying (and leaving) and failing again is counted, not listed each time.
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('.field-status.is-error')).toBeVisible();
  const entry = await data.entry(TODAY);
  expect(entry ? entry.weight : null).toBe(null);

  await page.getByRole('link', { name: 'Settings' }).click();
  const card = page.locator('[data-problem-log]');
  const item = card.locator('[data-problem]');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText(/Save the weight \(\d times\)/);
  await expect(item).toContainText('Today, 10:00 AM · The device’s storage was full');
  await expect(item).not.toContainText('Error');
  // Nothing typed or logged is kept in it.
  const stored = await page.evaluate(() => localStorage.getItem('kenna:problemLog'));
  expect(stored).not.toContain('181');
  expect(stored).not.toMatch(/quota has been exceeded|Failed to fetch/i);

  // Copy: plain text, ready to paste into a message.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => (window.copied = t) }, configurable: true });
  });
  await card.getByRole('button', { name: 'Copy log' }).click();
  await expect(card).toContainText('Copied. Paste it into a message');
  const copied = await page.evaluate(() => window.copied);
  expect(copied).toContain('Kenna problem log');
  expect(copied).toMatch(/2026-09-24T15:00:00\.000Z {2}Save the weight: KennaError ← \w+.*\(\d times in a row\)/);
  expect(copied).not.toContain('181');

  await card.getByRole('button', { name: 'Clear…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear' }).click();
  await expect(card).toContainText('Nothing has gone wrong on this device.');
  expect(await page.evaluate(() => localStorage.getItem('kenna:problemLog'))).toBe(null);
});

test('an error nothing else caught is noted with where in the code it happened', async ({ page, appURL }) => {
  await page.goto(appURL);
  await expect(page.getByLabel('Weight (lbs)')).toBeVisible();
  await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = "throw new TypeError('secret 181.4')";
    document.head.append(script);
    Promise.reject(new RangeError('also secret'));
  });
  await page.goto(`${appURL}/#/settings`);
  const items = page.locator('[data-problem-log] [data-problem]');
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText('A fault in Kenna itself');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('kenna:problemLog')));
  expect(stored.map((e) => `${e.op}: ${e.error}`).sort()).toEqual(['Unexpected error: RangeError', 'Unexpected error: TypeError']);
  expect(JSON.stringify(stored)).not.toContain('secret');
});

test('the problem log never grows past its limit', async ({ page, appURL }) => {
  await page.goto(appURL);
  await page.evaluate(() => {
    const events = Array.from({ length: 80 }, (_, i) => ({ at: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(), op: `Old ${i}`, error: 'Error' }));
    localStorage.setItem('kenna:problemLog', JSON.stringify(events));
  });
  await page.goto(`${appURL}/#/settings`);
  const card = page.locator('[data-problem-log]');
  await expect(card.locator('[data-problem]')).toHaveCount(5);
  await expect(card.locator('[data-problem]').first()).toContainText('Old 79');
  await expect(card).toContainText('and 25 earlier');

  // A new failure pushes out the oldest.
  await page.evaluate(() => {
    Promise.reject(new Error('x'));
  });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('kenna:problemLog')).length)).toBe(30);
  const ops = await page.evaluate(() => JSON.parse(localStorage.getItem('kenna:problemLog')).map((e) => e.op));
  expect(ops[0]).toBe('Old 51');
  expect(ops[ops.length - 1]).toBe('Unexpected error');
});

test('picking a file that isn’t a photo is explained, and isn’t noted as a problem', async ({ page, appURL }) => {
  await page.goto(`${appURL}/#/photos`);
  await page.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') });
  await expect(page.getByText("Photo not saved. That file isn't a photo we can show.")).toBeVisible();
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.locator('[data-problem-log]')).toContainText('Nothing has gone wrong on this device.');
});
