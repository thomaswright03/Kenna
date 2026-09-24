const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalStore, ENTRIES_KEY, BACKUP_KEY, CORRUPT_KEY } = require('../../docs/store-local.js');

function fakeStorage(initial = {}, { failWrites = false } = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
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

test('each write keeps the previous version as an automatic backup', async () => {
  const storage = fakeStorage();
  const { store } = makeStore(storage);
  await store.updateEntry('2026-09-23', { weight: 181 });
  await store.updateEntry('2026-09-24', { weight: 180 });
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(BACKUP_KEY))), ['2026-09-23']);
});

test('corrupted data is recovered from the automatic backup, keeping the damaged copy', async () => {
  const good = JSON.stringify({ '2026-09-23': { date: '2026-09-23', weight: 181, meals: {} } });
  const storage = fakeStorage({ [ENTRIES_KEY]: '{not json', [BACKUP_KEY]: good });
  const { store, notices } = makeStore(storage);
  const entries = await store.loadEntries();
  assert.equal(entries['2026-09-23'].weight, 181);
  assert.equal(storage.getItem(ENTRIES_KEY), good, 'the primary copy is healed');
  assert.equal(storage.getItem(CORRUPT_KEY), '{not json');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].tone, 'warning');
});

test('unrecoverable corruption starts fresh without destroying the damaged data', async () => {
  const storage = fakeStorage({ [ENTRIES_KEY]: '{bad', [BACKUP_KEY]: 'also bad' });
  const { store, notices } = makeStore(storage);
  assert.deepEqual(await store.loadEntries(), {});
  assert.equal(notices[0].tone, 'error');
  await store.updateEntry('2026-09-24', { weight: 180 });
  assert.equal(storage.getItem(CORRUPT_KEY), '{bad');
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
  await assert.rejects(store.updateEntry('2026-09-24', { weight: 180 }), /Not saved: this browser's storage for Kenna is full/);
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
