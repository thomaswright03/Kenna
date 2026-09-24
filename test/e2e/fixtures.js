const base = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const url = require('node:url');
const { createStaticServer } = require('../../scripts/serve-docs.js');
const { createApp } = require('../../server.js');

// Tests run with the clock fixed at 10:00 on Thu, Sep 24 2026 (Chicago).
const TODAY = '2026-09-24';
const NOW = new Date('2026-09-24T10:00:00-05:00');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

// npm run coverage sets KENNA_COVERAGE to a folder: each test's page then
// records which of the app's code ran (Chromium only), saved in the format
// Node writes with NODE_V8_COVERAGE, so c8 can report it with the unit
// tests' and map the built files back to their sources.
const COVERAGE_DIR = process.env.KENNA_COVERAGE;
const DOCS_DIR = path.join(__dirname, '..', '..', 'docs');

function startCoverage(page) {
  const on = !!COVERAGE_DIR && !!page.coverage;
  const started = on ? page.coverage.startJSCoverage({ resetOnNavigation: false }) : null;
  return {
    async save(testInfo) {
      if (!on) return;
      await started;
      const entries = await page.coverage.stopJSCoverage().catch(() => []);
      const result = [];
      for (const e of entries) {
        const m = /^https?:\/\/127\.0\.0\.1:\d+\/(build\/[\w.-]+\.js)(?:\?.*)?$/.exec(e.url);
        if (m) result.push({ scriptId: e.scriptId, url: url.pathToFileURL(path.join(DOCS_DIR, m[1])).href, functions: e.functions });
      }
      if (!result.length) return;
      fs.mkdirSync(COVERAGE_DIR, { recursive: true });
      const name = `coverage-page-${process.pid}-${testInfo.workerIndex}-${testInfo.testId}-${testInfo.retry}.json`;
      fs.writeFileSync(path.join(COVERAGE_DIR, name), JSON.stringify({ result }));
    },
  };
}

const test = base.test.extend({
  backend: ['local', { option: true }],
  // Kenna opened from the Home Screen, as it's meant to be used. Tests of
  // the browser-tab note set this to false.
  installed: [true, { option: true }],

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

  page: async ({ page, context, installed }, use, testInfo) => {
    const coverage = startCoverage(page);
    await page.clock.setFixedTime(NOW);
    if (installed) {
      await context.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true });
      });
    }
    // Backups go through the download path unless a test stands in a share
    // sheet (whether a desktop test browser can share files differs by engine).
    await page.addInitScript(() => {
      delete Navigator.prototype.share;
      delete Navigator.prototype.canShare;
    });
    page.on('dialog', (d) => {
      throw new Error(`Unexpected native dialog: ${d.message()}`);
    });
    await use(page);
    await coverage.save(testInfo);
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
