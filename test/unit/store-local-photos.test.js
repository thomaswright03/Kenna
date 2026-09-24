// Photo storage in the browser store, run against an in-memory IndexedDB.
const test = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory } = require('fake-indexeddb');
const { createLocalStore } = require('../../docs/store-local.js');

const JPEG = (n, size = 64) => {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0, n & 255]);
  return bytes;
};

function makeStore(idb, extra = {}) {
  const storage = new Map();
  return createLocalStore({
    storage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    indexedDB: idb,
    ...extra,
  });
}

// Writes photos the way every earlier version did: straight into the
// "photos" store of "kenna-photos", with no index.
function seedOldPhotos(idb, records) {
  return new Promise((resolve, reject) => {
    const req = idb.open('kenna-photos', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => {
      const t = req.result.transaction('photos', 'readwrite');
      for (const r of records) t.objectStore('photos').add(r);
      t.oncomplete = () => {
        req.result.close();
        resolve();
      };
      t.onerror = () => reject(t.error);
    };
    req.onerror = () => reject(req.error);
  });
}

test('photos saved by earlier versions are listed, newest first, without reading their images', async () => {
  const idb = new IDBFactory();
  await seedOldPhotos(idb, [
    { date: '2026-09-20', createdAt: '2026-09-20T12:00:00.000Z', bytes: JPEG(1).buffer, type: 'image/jpeg' },
    { date: '2026-09-22', createdAt: '2026-09-22T12:00:00.000Z', blob: new Blob([JPEG(2)], { type: 'image/png' }) },
    { date: '2026-09-23', createdAt: '2026-09-23T12:00:00.000Z' }, // no image at all
  ]);
  const store = makeStore(idb);
  const photos = await store.listPhotos();
  assert.deepEqual(
    photos.map((p) => [p.date, p.type]),
    [
      ['2026-09-22', 'image/png'],
      ['2026-09-20', 'image/jpeg'],
    ]
  );
  for (const p of photos) assert.deepEqual(Object.keys(p).sort(), ['createdAt', 'date', 'id', 'type']);
  const blob = await store.getPhotoBlob(photos[1]);
  assert.equal(blob.size, 64);
  assert.equal((await store.getPhotoBlob(photos[0])).type, 'image/png');
  assert.equal(await store.countPhotos(), 3);
});

test('the index follows photos added, moved and deleted, including by an older copy of the app', async () => {
  const idb = new IDBFactory();
  const store = makeStore(idb);
  const a = await store.addPhoto({ date: '2026-09-21', createdAt: '2026-09-21T08:00:00.000Z', blob: new Blob([JPEG(1)], { type: 'image/jpeg' }) });
  await store.addPhoto({ date: '2026-09-22', createdAt: '2026-09-22T08:00:00.000Z', blob: new Blob([JPEG(2)], { type: 'image/jpeg' }) });
  await store.updatePhoto(a.id, { date: '2026-09-19' });
  let photos = await store.listPhotos();
  assert.deepEqual(photos.map((p) => p.date), ['2026-09-22', '2026-09-19']);

  // An older version (after a rollback) adds a photo straight to the photos store.
  await seedOldPhotos(idb, [{ date: '2026-09-23', createdAt: '2026-09-23T08:00:00.000Z', bytes: JPEG(3).buffer, type: 'image/jpeg' }]);
  photos = await makeStore(idb).listPhotos();
  assert.deepEqual(photos.map((p) => p.date), ['2026-09-23', '2026-09-22', '2026-09-19']);

  await store.deletePhoto(a.id);
  photos = await store.listPhotos();
  assert.equal(photos.length, 2);
  await assert.rejects(store.getPhotoBlob(a), /missing its image/);
});

test('previews are made once, from the stored photo, and kept', async () => {
  const idb = new IDBFactory();
  let made = 0;
  const makeThumbnail = async (blob) => {
    made += 1;
    return new Blob([new Uint8Array(8)], { type: 'image/jpeg', size: blob.size });
  };
  await seedOldPhotos(idb, [{ date: '2026-09-20', createdAt: '2026-09-20T12:00:00.000Z', bytes: JPEG(1, 4096).buffer, type: 'image/jpeg' }]);
  const store = makeStore(idb, { makeThumbnail });
  const [photo] = await store.listPhotos();
  const first = await store.photoUrl(photo, 'thumb');
  const again = await makeStore(idb, { makeThumbnail }).photoUrl(photo, 'thumb');
  assert.equal(made, 1);
  first.release();
  again.release();

  // A photo added with its preview never needs one made.
  const added = await store.addPhoto({ date: '2026-09-21', blob: new Blob([JPEG(2, 4096)]), thumb: new Blob([new Uint8Array(8)], { type: 'image/jpeg' }) });
  (await store.photoUrl(added, 'thumb')).release();
  assert.equal(made, 1);
});

test("a photo this browser can't draw falls back to the full image, and isn't retried", async () => {
  const idb = new IDBFactory();
  let tries = 0;
  const store = makeStore(idb, {
    makeThumbnail: async () => {
      tries += 1;
      return null;
    },
  });
  const photo = await store.addPhoto({ date: '2026-09-21', blob: new Blob([JPEG(1, 100)], { type: 'image/heic' }) });
  const src = await store.photoUrl(photo, 'thumb');
  assert.match(src.url, /^blob:/);
  src.release();
  (await store.photoUrl(photo, 'thumb')).release();
  assert.equal(tries, 1);
});

test('importing skips photos already here, matched by the time they were first added', async () => {
  const idb = new IDBFactory();
  const store = makeStore(idb);
  await store.addPhoto({ date: '2026-09-21', createdAt: '2026-09-21T08:00:00.000Z', blob: new Blob([JPEG(1)], { type: 'image/jpeg' }) });
  const importer = await store.createPhotoImporter();
  const data = Buffer.from(JPEG(9)).toString('base64');
  assert.equal(await importer.add({ date: '2026-09-18', createdAt: '2026-09-21T08:00:00.000Z', type: 'image/jpeg', data }), false);
  assert.equal(await importer.add({ date: '2026-09-18', createdAt: '2026-09-18T08:00:00.000Z', type: 'image/jpeg', data }), true);
  assert.equal(await importer.add({ date: '2026-09-18', createdAt: '2026-09-18T08:00:00.000Z', type: 'image/jpeg', data }), false);
  assert.equal((await store.listPhotos()).length, 2);
});

test('a photo cannot be filed under a day that has not happened yet', async () => {
  const store = makeStore(new IDBFactory());
  await assert.rejects(store.addPhoto({ date: '2999-01-01', blob: new Blob([JPEG(1)]) }), /hasn't happened yet/);
  assert.equal(await store.countPhotos(), 0);
});

test("photo storage failures come back as Kenna's own sentences, never the browser's error text", async () => {
  const { KennaError } = require('../../docs/core.js');
  // A browser that can't open its IndexedDB files.
  const broken = {
    open() {
      const req = {};
      setTimeout(() => {
        req.error = Object.assign(new Error('Internal error opening backing store for indexedDB.open.'), { name: 'UnknownError' });
        req.onerror();
      });
      return req;
    },
  };
  const store = makeStore(broken);
  await assert.rejects(store.listPhotos(), (err) => {
    assert.ok(err instanceof KennaError);
    assert.match(err.message, /^Kenna couldn't open its photo storage on this device\. Nothing has been deleted/);
    assert.doesNotMatch(err.message, /indexedDB|backing store/);
    return true;
  });
  await assert.rejects(store.addPhoto({ date: '2026-09-20', blob: new Blob([JPEG(1)], { type: 'image/jpeg' }) }), /Kenna couldn't write to its photo storage/);

  // A device that has run out of room.
  const idb = new IDBFactory();
  const full = makeStore(idb);
  await full.listPhotos();
  const { IDBObjectStore } = require('fake-indexeddb');
  const add = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function () {
    throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
  };
  try {
    await assert.rejects(full.addPhoto({ date: '2026-09-20', blob: new Blob([JPEG(2)], { type: 'image/jpeg' }) }), (err) => {
      assert.match(err.message, /There's no room left for Kenna's photos.*Delete some old progress photos or free up space on the phone/);
      assert.doesNotMatch(err.message, /quota/);
      return true;
    });
  } finally {
    IDBObjectStore.prototype.add = add;
  }

  // No IndexedDB at all.
  await assert.rejects(makeStore(undefined).listPhotos(), /turned off the storage Kenna keeps photos in/);
});
