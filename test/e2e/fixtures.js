const base = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStaticServer } = require('../../scripts/serve-docs.js');
const { createApp } = require('../../server.js');

// Tests run with the clock fixed at 10:00 on Thu, Sep 24 2026 (Chicago).
const TODAY = '2026-09-24';
const NOW = new Date('2026-09-24T10:00:00-05:00');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

const test = base.test.extend({
  backend: ['local', { option: true }],

  // Starts a fresh, empty copy of the app; call again for a second, empty one.
  startApp: async ({ backend }, use) => {
    const cleanups = [];
    await use(async () => {
      if (backend === 'local') {
        const server = createStaticServer();
        const url = await listen(server);
        cleanups.push(() => server.close());
        return url;
      }
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kenna-e2e-'));
      const server = createApp({ dataDir }).listen(0, '127.0.0.1');
      await new Promise((r) => server.once('listening', r));
      cleanups.push(() => {
        server.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
      });
      return `http://127.0.0.1:${server.address().port}`;
    });
    for (const fn of cleanups) fn();
  },

  appURL: async ({ startApp }, use) => {
    await use(await startApp());
  },

  page: async ({ page }, use) => {
    await page.clock.setFixedTime(NOW);
    page.on('dialog', (d) => {
      throw new Error(`Unexpected native dialog: ${d.message()}`);
    });
    await use(page);
  },

  // Reads and writes the stored days through whichever storage is in use.
  data: async ({ backend, appURL, page }, use) => {
    await use({
      async seed(entries) {
        if (backend === 'local') {
          await page.goto(appURL);
          await page.evaluate((e) => localStorage.setItem('kenna:entries', JSON.stringify(e)), entries);
        } else {
          const res = await page.request.post(`${appURL}/api/import`, { data: { entries } });
          if (!res.ok()) throw new Error(await res.text());
        }
      },
      async entry(date) {
        if (backend === 'local') {
          return page.evaluate((d) => {
            const all = JSON.parse(localStorage.getItem('kenna:entries') || '{}');
            return all[d] || null;
          }, date);
        }
        const res = await page.request.get(`${appURL}/api/entries/${date}`);
        return res.json();
      },
    });
  },
});

function day(date, meals = {}, weight = null) {
  return {
    date,
    weight,
    meals: { breakfast: null, snack1: null, lunch: null, snack2: null, dinner: null, snack3: null, ...meals },
  };
}

module.exports = { test, expect: base.expect, TODAY, NOW, day };
