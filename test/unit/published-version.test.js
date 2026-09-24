// The version phones run now (the published branch) and this one share the
// days in localStorage: an update must read every day the published
// version saved, and rolling back to it must find every day this one
// saved. published/data-1256a23.js is that version's built data.js (its
// rules and storage), exactly as Pages serves it; replace it with the new
// build (and rename it after its commit) whenever the published branch
// changes how days are stored.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const current = require('../../docs/store-local.js');

/** The published version's storage, run as the page runs it. */
function publishedStore(storage) {
  const context = vm.createContext({ console, setTimeout, clearTimeout, Date, Intl });
  context.self = context;
  context.window = context;
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'published', 'data-1256a23.js'), 'utf8'), context);
  return context.KennaLocalStore.createLocalStore({ storage });
}

const currentStore = (storage) => current.createLocalStore({ storage });

function fakeStorage() {
  const data = new Map();
  return {
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

// A plain copy, so days made in the published version's context compare equal.
const plain = (value) => JSON.parse(JSON.stringify(value));

test('an update reads every day the published version saved, and keeps them through its own saves', async () => {
  const storage = fakeStorage();
  const before = publishedStore(storage);
  await before.updateEntry('2026-09-18', { weight: 181.25, meals: { breakfast: 420, dinner: 780 } });
  await before.updateEntry('2026-09-19', { meals: { lunch: 0, snack2: 150 } });
  await before.updateEntry('2026-09-20', { weight: 180.5 });
  await before.updateEntry('2026-09-20', { meals: { snack1: 90 } });
  const saved = plain(await before.loadEntries());
  assert.equal(Object.keys(saved).length, 3);

  const after = currentStore(storage);
  assert.deepEqual(plain(await after.loadEntries()), saved);
  await after.updateEntry('2026-09-19', { meals: { lunch: 610 } });
  await after.updateEntry('2026-09-21', { weight: 179.8 });
  const expected = { ...saved, '2026-09-19': { ...saved['2026-09-19'], meals: { ...saved['2026-09-19'].meals, lunch: 610 } } };
  const now = plain(await currentStore(storage).loadEntries());
  assert.equal(now['2026-09-21'].weight, 179.8);
  delete now['2026-09-21'];
  assert.deepEqual(now, expected);
});

test('rolling back to the published version finds every day this version saved', async () => {
  const storage = fakeStorage();
  const store = currentStore(storage);
  for (let d = 1; d <= 20; d += 1) {
    const date = `2026-09-${String(d).padStart(2, '0')}`;
    await store.updateEntry(date, { weight: 170 + d / 4, meals: { breakfast: 300 + d, lunch: 500 } });
  }
  await store.updateEntry('2026-09-05', { meals: { lunch: null } });
  // A day emptied here is gone for the published version too.
  await store.updateEntry('2026-09-06', { weight: null, meals: { breakfast: null, lunch: null } });
  const saved = plain(await currentStore(storage).loadEntries());
  assert.equal(Object.keys(saved).length, 19);

  const rolledBack = publishedStore(storage);
  assert.deepEqual(plain(await rolledBack.loadEntries()), saved);
  // And its own saves keep them.
  await rolledBack.updateEntry('2026-09-21', { meals: { dinner: 700 } });
  const again = plain(await currentStore(storage).loadEntries());
  assert.equal(Object.keys(again).length, 20);
  assert.deepEqual(again['2026-09-05'], saved['2026-09-05']);
});
