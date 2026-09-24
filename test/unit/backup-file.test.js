const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackupWriter, createScanner, checkBackup, forEachBackupPhoto, BackupFormatError, CHUNK_BYTES } = require('../../docs/backup-file.js');

const meals = (m) => ({ breakfast: null, snack1: null, lunch: null, snack2: null, dinner: null, snack3: null, ...m });

function scanInPieces(text, sizes) {
  const scanner = createScanner(['photos']);
  const items = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const size = sizes[k % sizes.length];
    items.push(...scanner.push(text.slice(i, i + size)));
    i += size;
    k += 1;
  }
  const { values, streamed } = scanner.end();
  return { items: items.map((it) => JSON.parse(it.text)), values, streamed };
}

test('the scanner splits out each photo and the other values, however the text is cut', () => {
  const doc = {
    app: 'kenna',
    version: 2,
    exportedAt: '2026-09-24T10:00:00.000Z',
    entries: { '2026-09-24': { date: '2026-09-24', weight: 180.5, meals: meals({ lunch: 600 }) }, note: { a: [1, { b: '}],' }] } },
    photos: [
      { date: '2026-09-23', createdAt: 'x', type: 'image/jpeg', data: 'AAAA' },
      { date: '2026-09-24', createdAt: 'y "quoted" \\ back\\slash, [brackets] {braces}', type: 'image/png', data: 'BBBB' },
    ],
    trailing: true,
  };
  for (const text of [JSON.stringify(doc), JSON.stringify(doc, null, 2), `\uFEFF${JSON.stringify(doc, null, '\t')}\n`]) {
    for (const sizes of [[text.length], [1], [2], [3], [7], [64], [5, 1, 13]]) {
      const { items, values, streamed } = scanInPieces(text, sizes);
      assert.deepEqual(items, doc.photos, `sizes ${sizes}`);
      assert.deepEqual(JSON.parse(values.entries), doc.entries);
      assert.equal(JSON.parse(values.version), 2);
      assert.equal(JSON.parse(values.trailing), true);
      assert.ok(streamed.has('photos'));
    }
  }
});

test('the scanner rejects text that is not a well-formed JSON object', () => {
  for (const bad of ['', '[]', '{', '{"a":1', '{"a":1,}', '{"photos":[1,]}', '{"photos":[,1]}', '{"a" 1}', '{a:1}', '{"a":1} x', '{"a":1]', '{"photos":[1}']) {
    assert.throws(() => scanInPieces(bad, [3]), BackupFormatError, JSON.stringify(bad));
  }
  const { values, streamed } = scanInPieces('{"photos": 5, "entries": {}}', [4]);
  assert.equal(values.photos, '5');
  assert.equal(streamed.has('photos'), false);
});

async function roundTrip(photoCount) {
  const entries = { '2026-09-23': { date: '2026-09-23', weight: 180.2, meals: meals({ breakfast: 400 }) } };
  const writer = createBackupWriter(entries, '2026-09-24T10:00:00.000Z');
  const photos = [];
  for (let i = 0; i < photoCount; i += 1) {
    const data = Buffer.alloc(300 * 1024 + i, i % 251).toString('base64');
    const photo = { date: '2026-09-23', createdAt: new Date(Date.UTC(2026, 8, 23, 0, 0, i)).toISOString(), type: 'image/jpeg', data };
    photos.push(photo);
    writer.addPhoto(photo);
  }
  return { entries, photos, blob: writer.finish() };
}

test('a written backup reads back in slices with every day and photo intact', async () => {
  const { entries, photos, blob } = await roundTrip(8);
  assert.ok(blob.size > 2 * CHUNK_BYTES, 'spans several slices');
  const progress = [];
  const checked = await checkBackup(blob, { onProgress: (n) => progress.push(n) });
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.entries, entries);
  assert.equal(checked.dayCount, 1);
  assert.equal(checked.photoCount, 8);
  const seen = [];
  await forEachBackupPhoto(blob, async (photo, n) => {
    seen.push([n, photo]);
  });
  assert.deepEqual(
    seen.map(([n]) => n),
    [1, 2, 3, 4, 5, 6, 7, 8]
  );
  assert.deepEqual(
    seen.map(([, p]) => p),
    photos
  );
  const text = await blob.text();
  assert.equal(JSON.parse(text).photos.length, 8, 'the file is ordinary JSON');
});

test('checking a backup reports problems without importing anything', async () => {
  const unreadable = await checkBackup(new Blob(['{"entries": {"2026-09-01": {"meals": {}}}, "photos": [']));
  assert.equal(unreadable.ok, false);
  assert.match(unreadable.error, /isn't readable backup data/);

  const badPhoto = await checkBackup(
    new Blob([JSON.stringify({ entries: {}, photos: [{ date: '2026-01-01', createdAt: 'nope', type: 'image/jpeg', data: 'AA==' }, 7] })])
  );
  assert.equal(badPhoto.ok, false);
  assert.match(badPhoto.error, /^Nothing was imported\. Photo 1 has no valid upload time\. \(and 1 more problem\)/);

  const mixed = await checkBackup(
    new Blob([
      JSON.stringify({
        entries: { '2026-09-01': { meals: { breakfast: -5 } }, '2026-09-02': { meals: { lunch: 600 } } },
        photos: [7, { date: '2026-09-02', createdAt: '2026-09-02T08:00:00.000Z', type: 'image/jpeg', data: 'AA==' }],
      }),
    ])
  );
  assert.equal(mixed.ok, true, 'what can be restored is');
  assert.deepEqual(Object.keys(mixed.entries), ['2026-09-02']);
  assert.equal(mixed.photoCount, 1);
  assert.deepEqual(mixed.skipped, ["Breakfast on Tue, Sep 1 (-5): Calories can't be negative. Enter 0 or more.", "Photo 1 isn't in the expected format."]);
  const handed = [];
  await forEachBackupPhoto(new Blob([JSON.stringify({ entries: {}, photos: [7, { date: '2026-09-02', createdAt: '2026-09-02T08:00:00.000Z', type: 'image/jpeg', data: 'AA==' }] })]), async (p, n) => {
    handed.push(n);
  });
  assert.deepEqual(handed, [2], 'photos listed as left out are passed over');

  const notKenna = await checkBackup(new Blob([JSON.stringify({ app: 'other', entries: {} })]));
  assert.equal(notKenna.ok, false);

  const v1 = await checkBackup(new Blob([JSON.stringify({ exportedAt: 'x', entries: { '2025-05-01': { date: '2025-05-01', weight: 150, meals: {} } } }, null, 2)]));
  assert.equal(v1.ok, true);
  assert.equal(v1.photoCount, 0);
});
