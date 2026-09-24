const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalStore, ENTRIES_KEY, BACKUP_KEY, RECENT_KEY, RECENT_BACKUP_KEY, MAX_RECENT_DAYS, CORRUPT_KEY } = require('../../docs/store-local.js');

function fakeStorage(initial = {}, { failWrites = false } = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      if (failWrites) {
        const err = new Error('quota');
        err.name = 'QuotaExceededError';
        throw err;
      }
      data.set(k, String(v));
    },
    removeItem: (k) => data.delete(k),
  };
}

function makeStore(storage) {
  const notices = [];
  const store = createLocalStore({ storage, onNotice: (n) => notices.push(n) });
  return { store, notices };
}

test('saving a meal only changes that meal, keeping other edits to the same day', async () => {
  const storage = fakeStorage();
  const a = makeStore(storage).store;
  const b = makeStore(storage).store; // a second tab on the same storage
  await a.updateEntry('2026-09-24', { meals: { breakfast: 400 } });
  await b.updateEntry('2026-09-24', { meals: { lunch: 650 } });
  await a.updateEntry('2026-09-24', { weight: 180 });
  const entry = await a.getEntry('2026-09-24');
  assert.equal(entry.meals.breakfast, 400);
  assert.equal(entry.meals.lunch, 650);
  assert.equal(entry.weight, 180);
});

test('a day with nothing left in it is removed instead of lingering as an empty day', async () => {
  const { store } = makeStore(fakeStorage());
  await store.updateEntry('2026-09-24', { meals: { breakfast: 400 } });
  await store.updateEntry('2026-09-24', { meals: { breakfast: null } });
  assert.deepEqual(await store.loadEntries(), {});
});

test('each save keeps the previous changes as an automatic copy, and folding keeps a copy of every day', async () => {
  const storage = fakeStorage();
  const { store } = makeStore(storage);
  await store.updateEntry('2026-09-23', { weight: 181 });
  await store.updateEntry('2026-09-24', { weight: 180 });
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(RECENT_BACKUP_KEY)).days), ['2026-09-23']);
  assert.equal(await store.settle(), true);
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(ENTRIES_KEY))), ['2026-09-23', '2026-09-24']);
  assert.equal(storage.getItem(BACKUP_KEY), storage.getItem(ENTRIES_KEY));
  assert.equal(storage.getItem(RECENT_KEY), null);
  assert.equal(storage.getItem(RECENT_BACKUP_KEY), null);
  assert.equal(await store.settle(), false, 'nothing left to fold');
});

/** A history of `days` days before Sep 24, 2026, as ENTRIES_KEY holds it. */
function history(days) {
  const all = {};
  for (let i = 1; i <= days; i += 1) {
    const date = new Date(Date.UTC(2026, 8, 24 - i)).toISOString().slice(0, 10);
    all[date] = { date, weight: 180 + (i % 10) / 10, meals: { breakfast: 400, lunch: 650, dinner: 800 } };
  }
  return all;
}

test('a save writes only the days changed since the last fold, however many years are logged', async () => {
  const written = {};
  for (const [label, days] of [['a month', 30], ['ten years', 3650]]) {
    const storage = fakeStorage({ [ENTRIES_KEY]: JSON.stringify(history(days)) });
    const before = storage.getItem(ENTRIES_KEY);
    const { store } = makeStore(storage);
    const setItem = storage.setItem;
    let bytes = 0;
    storage.setItem = (k, v) => {
      bytes += String(v).length;
      setItem(k, v);
    };
    await store.updateEntry('2026-09-24', { meals: { lunch: 600 } });
    await store.updateEntry('2026-09-24', { meals: { dinner: 700 } });
    written[label] = bytes;
    assert.equal(storage.getItem(ENTRIES_KEY), before, `${label}: the whole history isn't rewritten`);
    const entries = await store.loadEntries();
    assert.equal(Object.keys(entries).length, days + 1);
    assert.equal(entries['2026-09-24'].meals.dinner, 700);
  }
  // The same, give or take the digits of the history's length.
  assert.ok(Math.abs(written['ten years'] - written['a month']) < 20, JSON.stringify(written));
  assert.ok(written['ten years'] < 1000, `${written['ten years']} bytes`);
});

test('changes pile up to a limit, then the next save folds them in', async () => {
  const storage = fakeStorage();
  const { store } = makeStore(storage);
  for (let i = 1; i <= MAX_RECENT_DAYS; i += 1) {
    await store.updateEntry(new Date(Date.UTC(2026, 7, i)).toISOString().slice(0, 10), { weight: 180 });
  }
  assert.equal(storage.getItem(ENTRIES_KEY), null);
  await store.updateEntry('2026-09-24', { weight: 179 });
  assert.equal(Object.keys(JSON.parse(storage.getItem(ENTRIES_KEY))).length, MAX_RECENT_DAYS + 1);
  assert.equal(storage.getItem(RECENT_KEY), null);
});

test('a day removed since the last fold stays removed, and an older version reads every day once folded', async () => {
  const storage = fakeStorage({ [ENTRIES_KEY]: JSON.stringify(history(3)) });
  const { store } = makeStore(storage);
  await store.updateEntry('2026-09-23', { weight: null, meals: { breakfast: null, lunch: null, dinner: null } });
  assert.equal(await store.getEntry('2026-09-23'), null);
  assert.deepEqual(Object.keys(await store.loadEntries()).sort(), ['2026-09-21', '2026-09-22']);
  // Starting again folds what an earlier visit left.
  await makeStore(storage).store.init();
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(ENTRIES_KEY))).sort(), ['2026-09-21', '2026-09-22']);
});

test('damaged recent changes are restored from their copy', async () => {
  const storage = fakeStorage();
  const { store } = makeStore(storage);
  await store.updateEntry('2026-09-23', { weight: 181 });
  await store.updateEntry('2026-09-24', { weight: 180 });
  storage.setItem(RECENT_KEY, '{"base": 0, "da');
  const again = makeStore(storage);
  const entries = await again.store.loadEntries();
  assert.equal(entries['2026-09-23'].weight, 181);
  assert.equal(entries['2026-09-24'], undefined, 'only the very last change is missing');
  assert.equal(again.notices[0].tone, 'warning');
  assert.deepEqual(
    (await again.store.damagedCopies()).map((c) => c.text),
    ['{"base": 0, "da']
  );
});

test('changes left on top of days another version has changed since are set aside, not applied', async () => {
  const storage = fakeStorage();
  const { store } = makeStore(storage);
  await store.updateEntry('2026-09-23', { weight: 181 });
  const left = storage.getItem(RECENT_KEY);
  // An older version (after a rollback) knows only ENTRIES_KEY, and saves there.
  storage.setItem(ENTRIES_KEY, JSON.stringify(history(2)));
  const again = makeStore(storage);
  const entries = await again.store.loadEntries();
  assert.equal(entries['2026-09-23'].weight, history(2)['2026-09-23'].weight);
  assert.equal(again.notices.length, 1);
  assert.deepEqual(
    (await again.store.damagedCopies()).map((c) => c.text),
    [left]
  );
  assert.equal(storage.getItem(RECENT_KEY), null);
});

test('changes are set aside when every day was replaced by different days of exactly the same length', async () => {
  const days = history(2);
  const storage = fakeStorage({ [ENTRIES_KEY]: JSON.stringify(days) });
  const { store } = makeStore(storage);
  await store.updateEntry('2026-09-24', { weight: 179 });
  const left = storage.getItem(RECENT_KEY);
  // An older version changes one weight for another of the same width.
  const changed = JSON.stringify(days).replace('"weight":180.1', '"weight":180.9');
  assert.notEqual(changed, storage.getItem(ENTRIES_KEY));
  assert.equal(changed.length, storage.getItem(ENTRIES_KEY).length);
  storage.setItem(ENTRIES_KEY, changed);
  const again = makeStore(storage);
  const entries = await again.store.loadEntries();
  assert.equal(entries['2026-09-23'].weight, 180.9);
  assert.equal(entries['2026-09-24'], undefined);
  assert.deepEqual(
    (await again.store.damagedCopies()).map((c) => c.text),
    [left]
  );
});

test('changes written before they were marked with more than a length still apply', async () => {
  const days = history(2);
  const text = JSON.stringify(days);
  const storage = fakeStorage({
    [ENTRIES_KEY]: text,
    [RECENT_KEY]: JSON.stringify({ base: text.length, days: { '2026-09-24': { date: '2026-09-24', weight: 179, meals: {} } } }),
  });
  const again = makeStore(storage);
  const entries = await again.store.loadEntries();
  assert.equal(entries['2026-09-24'].weight, 179);
  assert.equal(entries['2026-09-23'].weight, days['2026-09-23'].weight);
  assert.equal(again.notices.length, 0);
});

test('days recovered from their copy keep the changes made since', async () => {
  const storage = fakeStorage({ [ENTRIES_KEY]: JSON.stringify(history(2)) });
  const { store } = makeStore(storage);
  await store.updateEntry('2026-09-21', { weight: 182 });
  await store.settle();
  await store.updateEntry('2026-09-24', { weight: 179 });
  storage.setItem(ENTRIES_KEY, '{damaged');
  const again = makeStore(storage);
  const entries = await again.store.loadEntries();
  assert.deepEqual(Object.keys(entries).sort(), ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24']);
  assert.equal(entries['2026-09-24'].weight, 179);
  assert.equal(again.notices[0].tone, 'warning');
  assert.equal(storage.getItem(RECENT_KEY), null, 'folded in straight away');
  assert.equal(JSON.parse(storage.getItem(ENTRIES_KEY))['2026-09-24'].weight, 179);
});

test('corrupted data is recovered from the automatic backup, keeping the damaged copy', async () => {
  const good = JSON.stringify({ '2026-09-23': { date: '2026-09-23', weight: 181, meals: {} } });
  const storage = fakeStorage({ [ENTRIES_KEY]: '{not json', [BACKUP_KEY]: good });
  const { store, notices } = makeStore(storage);
  const entries = await store.loadEntries();
  assert.equal(entries['2026-09-23'].weight, 181);
  assert.equal(storage.getItem(ENTRIES_KEY), good, 'the primary copy is healed');
  assert.deepEqual(
    (await store.damagedCopies()).map((c) => c.text),
    ['{not json']
  );
  assert.equal(notices.length, 1);
  assert.equal(notices[0].tone, 'warning');
});

test('unrecoverable corruption starts fresh without destroying the damaged data', async () => {
  const storage = fakeStorage({ [ENTRIES_KEY]: '{bad', [BACKUP_KEY]: 'also bad' });
  const { store, notices } = makeStore(storage);
  assert.deepEqual(await store.loadEntries(), {});
  assert.equal(notices[0].tone, 'error');
  await store.updateEntry('2026-09-24', { weight: 180 });
  assert.deepEqual(
    (await store.damagedCopies()).map((c) => c.text),
    ['{bad']
  );
  assert.notEqual(storage.getItem(BACKUP_KEY), '{bad', 'a damaged value never replaces the automatic backup');
});

test('non-object stored data counts as corrupted', async () => {
  const storage = fakeStorage({ [ENTRIES_KEY]: '[1,2,3]' });
  const { store, notices } = makeStore(storage);
  assert.deepEqual(await store.loadEntries(), {});
  assert.equal(notices.length, 1);
});

test('malformed stored days are skipped when reading but never deleted by a save', async () => {
  const storage = fakeStorage({
    [ENTRIES_KEY]: JSON.stringify({ '': { weight: 150 }, '2026-09-20': 'junk', '2026-09-21': { date: '2026-09-21', weight: 170, meals: {} } }),
  });
  const { store } = makeStore(storage);
  assert.deepEqual(Object.keys(await store.loadEntries()), ['2026-09-21']);
  await store.updateEntry('2026-09-24', { weight: 180 });
  await store.settle();
  const raw = JSON.parse(storage.getItem(ENTRIES_KEY));
  assert.deepEqual(raw[''], { weight: 150 });
  assert.equal(raw['2026-09-20'], 'junk');
});

test('legacy per-food meal arrays are still read correctly', async () => {
  const storage = fakeStorage({
    [ENTRIES_KEY]: JSON.stringify({ '2025-01-01': { date: '2025-01-01', weight: null, meals: { lunch: [{ calories: 600, percent: 50 }] } } }),
  });
  const { store } = makeStore(storage);
  const entry = await store.getEntry('2025-01-01');
  assert.equal(entry.meals.lunch, 300);
});

test('saves to an invalid date are refused', async () => {
  const { store } = makeStore(fakeStorage());
  await assert.rejects(store.updateEntry('', { weight: 180 }), /valid date/);
});

test('blocked or full storage is reported as not saved', async () => {
  const { store } = makeStore(fakeStorage({}, { failWrites: true }));
  assert.deepEqual(await store.init(), { ok: false, reason: 'blocked' });
  await assert.rejects(store.updateEntry('2026-09-24', { weight: 180 }), (err) => {
    assert.match(err.message, /^Not saved\. There's no room left for Kenna's data on this device\. Everything saved before is safe\./);
    assert.match(err.message, /Export a backup .*delete some old progress photos or free up space on the phone/);
    return true;
  });
});

test('importing merges days, replacing only the days in the file', async () => {
  const { store } = makeStore(fakeStorage());
  await store.updateEntry('2026-09-01', { weight: 190 });
  await store.updateEntry('2026-09-02', { weight: 189 });
  const count = await store.importEntries({ '2026-09-02': { date: '2026-09-02', weight: 170, meals: {} } });
  assert.equal(count, 1);
  const entries = await store.loadEntries();
  assert.equal(entries['2026-09-01'].weight, 190);
  assert.equal(entries['2026-09-02'].weight, 170);
});

test('days that have not happened yet are refused', async () => {
  const { store } = makeStore(fakeStorage());
  await assert.rejects(store.updateEntry('2999-01-01', { weight: 180 }), /You can't log a day that hasn't happened yet/);
  assert.deepEqual(await store.loadEntries(), {});
});

test('the phone storage refuses the same values the typed input refuses', async () => {
  const storage = fakeStorage();
  const { store } = makeStore(storage);
  await assert.rejects(store.updateEntry('2026-09-20', { weight: 165.123 }), /two decimal places/);
  await assert.rejects(store.updateEntry('2026-09-20', { meals: { lunch: 450.5 } }), /whole number/);
  assert.equal(storage.getItem(ENTRIES_KEY), null, 'nothing was written');
});

test('only the two newest damaged copies are kept, the first version\'s copy included, and they can be deleted', async () => {
  const storage = fakeStorage({ [CORRUPT_KEY]: '{from the first version' });
  const { store } = makeStore(storage);
  for (const text of ['{broken 1', '{broken 2', '{broken 2', '{broken 3']) {
    storage.setItem(ENTRIES_KEY, text);
    await store.loadEntries();
  }
  const copies = await store.damagedCopies();
  assert.deepEqual(
    copies.map((c) => c.text),
    ['{broken 3', '{broken 2']
  );
  assert.ok(copies.every((c) => !Number.isNaN(Date.parse(c.savedAt))));
  assert.equal([...storage.data.keys()].filter((k) => k.startsWith(CORRUPT_KEY)).length, 2);
  await store.deleteDamagedCopies();
  assert.deepEqual(await store.damagedCopies(), []);
});

test('a copy kept by the first version is offered, with its time unknown', async () => {
  const { store } = makeStore(fakeStorage({ [CORRUPT_KEY]: '{old' }));
  assert.deepEqual(await store.damagedCopies(), [{ savedAt: null, text: '{old' }]);
});

test('an import can be undone: replaced days come back exactly, added days go', async () => {
  const storage = fakeStorage();
  const { store } = makeStore(storage);
  await store.updateEntry('2026-09-24', { meals: { breakfast: 700 } });
  await store.settle();
  // A day stored by the first version, exactly as it was written then.
  const legacy = { date: '2026-09-01', weight: 165.333, meals: { lunch: [{ calories: 600, percent: 50 }] } };
  const raw = JSON.parse(storage.getItem(ENTRIES_KEY));
  raw['2026-09-01'] = legacy;
  storage.setItem(ENTRIES_KEY, JSON.stringify(raw));

  await store.importEntries({
    '2026-09-24': { date: '2026-09-24', weight: null, meals: { breakfast: 500 } },
    '2026-09-01': { date: '2026-09-01', weight: 165.33, meals: { lunch: 300 } },
    '2026-09-02': { date: '2026-09-02', weight: 170, meals: {} },
  });
  assert.equal((await store.getEntry('2026-09-24')).meals.breakfast, 500);
  assert.equal(await store.undoImport(), 3);
  assert.equal((await store.getEntry('2026-09-24')).meals.breakfast, 700);
  assert.deepEqual(JSON.parse(storage.getItem(ENTRIES_KEY))['2026-09-01'], legacy);
  assert.equal(await store.getEntry('2026-09-02'), null);
  await assert.rejects(store.undoImport(), /no restore to undo/);
});

test('if the days to be replaced cannot be kept first, nothing is restored', async () => {
  const storage = fakeStorage();
  const { store } = makeStore(storage);
  await store.updateEntry('2026-09-24', { meals: { breakfast: 700 } });
  const setItem = storage.setItem;
  storage.setItem = (k, v) => {
    if (k.endsWith(':before-import')) {
      const err = new Error('quota');
      err.name = 'QuotaExceededError';
      throw err;
    }
    setItem(k, v);
  };
  await assert.rejects(store.importEntries({ '2026-09-24': { date: '2026-09-24', weight: null, meals: { breakfast: 500 } } }), /^\w*Error: Nothing was restored\. There's no room left/);
  assert.equal((await store.getEntry('2026-09-24')).meals.breakfast, 700);
});

test('a value outside the rules is the user’s to fix; a change of another shape is a fault in Kenna', async () => {
  const core = require('../../docs/core.js');
  const { store } = makeStore(fakeStorage());
  await assert.rejects(store.updateEntry('2026-09-24', { weight: 20 }), (err) => err instanceof core.InputError);
  await assert.rejects(
    store.updateEntry('2026-09-24', { height: 20 }),
    (err) => err instanceof core.KennaError && !(err instanceof core.InputError) && /couldn't read this change/.test(err.message)
  );
  assert.deepEqual(await store.loadEntries(), {});
});
