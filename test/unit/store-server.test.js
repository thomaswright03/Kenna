const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServerStore, NOT_RESPONDING } = require('../../docs/store-server.js');
const { createApp } = require('../../server.js');
const core = require('../../docs/core.js');

const jsonResponse = (status, body) => new Response(body === undefined ? 'oops' : JSON.stringify(body), { status });

test('a server that never answers is reported as not responding', async () => {
  const hang = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  const store = createServerStore({ fetch: hang, timeoutMs: 50 });
  await assert.rejects(store.loadEntries(), (err) => err.message === NOT_RESPONDING);
  await assert.rejects(store.updateEntry('2026-09-24', { weight: 180 }), (err) => err.message === NOT_RESPONDING);
});

test('server errors without a message are explained in plain words, without status codes', async () => {
  const store = createServerStore({ fetch: async () => jsonResponse(500) });
  await assert.rejects(store.loadEntries(), (err) => {
    assert.doesNotMatch(err.message, /500/);
    assert.match(err.message, /Try again, and if it keeps happening, restart the server/);
    return true;
  });
  const rejecting = createServerStore({ fetch: async () => jsonResponse(400) });
  await assert.rejects(rejecting.loadEntries(), /didn't accept that/);
  const explained = createServerStore({ fetch: async () => jsonResponse(400, { error: 'Weight must be between 50 and 1000 lbs.' }) });
  await assert.rejects(explained.updateEntry('2026-09-24', { weight: 1 }), /Weight must be between/);
});

test('an unreachable server says so', async () => {
  const store = createServerStore({
    fetch: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  await assert.rejects(store.loadEntries(), /Couldn't reach the Kenna server/);
});

// Every method, against a real Kenna server in a temporary folder.

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const TODAY = core.todayStr();
const YESTERDAY = core.shiftDate(TODAY, -1);
const meals = (m) => ({ ...core.emptyMeals(), ...m });

async function serverStore(t, options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kenna-store-'));
  const server = createApp({ dataDir }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { store: createServerStore({ base, ...options }), base, dataDir };
}

test('days: init, save, read one, read all, import and undo the import', async (t) => {
  const { store } = await serverStore(t);
  assert.deepEqual(await store.init(), { ok: true });
  assert.equal(await store.getEntry(TODAY), null);

  const saved = await store.updateEntry(TODAY, { weight: 170.5 });
  assert.equal(saved.weight, 170.5);
  await store.updateEntry(TODAY, { meals: { lunch: 600 } });
  assert.deepEqual((await store.getEntry(TODAY)).meals, meals({ lunch: 600 }));
  await assert.rejects(store.updateEntry(TODAY, { weight: 5 }), /Weight/);

  assert.equal(await store.importEntries({ [TODAY]: { date: TODAY, weight: 171, meals: meals({ dinner: 900 }) }, [YESTERDAY]: { date: YESTERDAY, weight: null, meals: meals({ lunch: 500 }) } }), 2);
  const all = await store.loadEntries();
  assert.deepEqual(Object.keys(all).sort(), [YESTERDAY, TODAY]);
  assert.equal(all[TODAY].weight, 171);

  assert.equal(await store.undoImport(), 2);
  const after = await store.loadEntries();
  assert.deepEqual(Object.keys(after), [TODAY]);
  assert.equal(after[TODAY].weight, 170.5);
  await assert.rejects(store.undoImport(), /There is no restore to undo/);
});

test('photos: add, list, count, move, read, preview, import without duplicates, delete', async (t) => {
  const made = [];
  const { store, base } = await serverStore(t, {
    makeThumbnail: async (blob) => {
      made.push(blob.size);
      return new Blob([PNG], { type: 'image/png' });
    },
  });
  const photo = await store.addPhoto({ date: YESTERDAY, blob: new Blob([PNG], { type: 'image/png' }), createdAt: '2026-01-01T08:00:00.000Z' });
  assert.equal(photo.date, YESTERDAY);
  assert.equal(photo.type, 'image/png');
  assert.equal(await store.countPhotos(), 1);
  assert.deepEqual((await store.listPhotos()).map((p) => p.id), [photo.id]);

  const moved = await store.updatePhoto(photo.id, { date: TODAY });
  assert.equal(moved.date, TODAY);
  await assert.rejects(store.updatePhoto(photo.id, { date: core.shiftDate(TODAY, 5) }), /hasn't happened yet/);

  const blob = await store.getPhotoBlob(moved);
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), PNG);
  const full = await store.photoUrl(moved, 'full');
  assert.equal(full.url, `${base}${moved.url}`);

  // A photo stored without a preview gets one made once and kept on the server.
  const thumb = await store.photoUrl(moved, 'thumb');
  assert.equal(made.length, 1);
  thumb.release();
  const [listed] = await store.listPhotos();
  assert.ok(listed.thumbUrl, 'the preview was saved on the server');
  const again = await store.photoUrl(listed, 'thumb');
  assert.equal(again.url, `${base}${listed.thumbUrl}`);
  assert.equal(made.length, 1);

  const importer = await store.createPhotoImporter();
  const backupPhoto = { date: TODAY, createdAt: '2026-01-01T08:00:00.000Z', type: 'image/png', data: PNG.toString('base64') };
  assert.equal(await importer.add(backupPhoto), null, 'the same photo is recognised as already here');
  const added = await importer.add({ ...backupPhoto, createdAt: '2026-01-02T08:00:00.000Z' });
  assert.equal(added.date, TODAY);
  assert.equal(await store.countPhotos(), 2);

  await store.deletePhoto(photo.id);
  await store.deletePhoto(added.id);
  assert.equal(await store.countPhotos(), 0);
  await assert.rejects(store.deletePhoto(photo.id), /no longer exists/);
  await assert.rejects(store.getPhotoBlob(moved), /couldn't be read from the server/);
});

test('what the server version has no use for answers plainly', async (t) => {
  const { store } = await serverStore(t);
  assert.deepEqual(await store.damagedCopies(), []);
  await store.deleteDamagedCopies();
  assert.equal(await store.requestPersistence(), null);
  assert.equal(await store.persistenceStatus(), null);
  assert.equal(store.onExternalChange(() => {}), undefined);
  assert.equal(store.kind, 'server');
});
