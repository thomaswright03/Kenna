const base = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const { createStaticServer } = require('../../scripts/serve-docs.js');

// Tests run with the clock fixed at 10:00 on Thu, Sep 24 2026 (Chicago).
const TODAY = '2026-09-24';
// Must match WHATS_NEW_VERSION in docs/ui/whats-new.js.
const WHATS_NEW_VERSION = '2026-09';
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
  // Kenna opened from the Home Screen, as it's meant to be used. Tests of
  // the browser-tab note set this to false.
  installed: [true, { option: true }],

  // What's new opens by itself once for someone who already logged days;
  // tests of other things start with it already seen. Tests of it set this
  // to false.
  whatsNewSeen: [true, { option: true }],

  // Starts a fresh, empty copy of the app; call again for a second, empty one.
  // eslint-disable-next-line no-empty-pattern -- needs no other fixture
  startApp: async ({}, use) => {
    const cleanups = [];
    await use(async () => {
      const server = createStaticServer();
      const url = await listen(server);
      cleanups.push(() => server.close());
      return url;
    });
    for (const fn of cleanups) fn();
  },

  appURL: async ({ startApp }, use) => {
    await use(await startApp());
  },

  page: async ({ page, context, installed, whatsNewSeen }, use, testInfo) => {
    const coverage = startCoverage(page);
    await page.clock.setFixedTime(NOW);
    if (installed) {
      await context.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true });
      });
    }
    if (whatsNewSeen) {
      await context.addInitScript((version) => {
        try {
          if (localStorage.getItem('kenna:whatsNewSeen') === null) localStorage.setItem('kenna:whatsNewSeen', version);
        } catch {
          // Storage is blocked in this test; what's new never opens then.
        }
      }, WHATS_NEW_VERSION);
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

  // Reads and writes the stored days in the page's localStorage: every day
  // is under kenna:entries (see docs/store/entries.js).
  data: async ({ appURL, page }, use) => {
    const all = () => page.evaluate(() => JSON.parse(localStorage.getItem('kenna:entries') || '{}'));
    await use({
      async seed(entries) {
        await page.goto(appURL);
        await page.evaluate((e) => {
          localStorage.removeItem('kenna:entries:recent');
          localStorage.removeItem('kenna:entries:recent:backup');
          localStorage.setItem('kenna:entries', JSON.stringify(e));
        }, entries);
      },
      all,
      async entry(date) {
        return (await all())[date] || null;
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

module.exports = { test, expect: base.expect, TODAY, NOW, day, WHATS_NEW_VERSION };
