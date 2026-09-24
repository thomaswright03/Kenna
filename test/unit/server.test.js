const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp, startupAddresses } = require('../../server.js');

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function startServer(t, seed = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kenna-test-'));
  for (const [name, content] of Object.entries(seed)) fs.writeFileSync(path.join(dataDir, name), content);
  const errors = console.error;
  console.error = () => {};
  const server = createApp({ dataDir }).listen(0);
  await new Promise((r) => server.once('listening', r));
  t.after(() => {
    console.error = errors;
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, raw) => {
    const res = await fetch(base + url, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text, type: res.headers.get('content-type') };
  };
  return { call, dataDir, base };
}

test('days without meals report no calorie total instead of 0', async (t) => {
  const { call } = await startServer(t);
  await call('PATCH', '/api/entries/2026-09-22', { meals: { breakfast: 2000 } });
  await call('PATCH', '/api/entries/2026-09-23', { weight: 180 });
  const { json } = await call('GET', '/api/entries');
  assert.deepEqual(
    json.map((e) => [e.date, e.totalCalories, e.weight]),
    [
      ['2026-09-23', null, 180],
      ['2026-09-22', 2000, null],
    ]
  );
});

test('PATCH changes only the given fields', async (t) => {
  const { call } = await startServer(t);
  await call('PATCH', '/api/entries/2026-09-24', { meals: { breakfast: 400 } });
  await call('PATCH', '/api/entries/2026-09-24', { meals: { lunch: 650 } });
  const { json } = await call('PATCH', '/api/entries/2026-09-24', { weight: 180.5 });
  assert.equal(json.meals.breakfast, 400);
  assert.equal(json.meals.lunch, 650);
  assert.equal(json.weight, 180.5);
  assert.equal(json.totalCalories, 1050);
});

test('impossible dates and out-of-range values are rejected with readable JSON errors', async (t) => {
  const { call } = await startServer(t);
  for (const [method, url, body] of [
    ['PATCH', '/api/entries/2026-99-99', { meals: {} }],
    ['PATCH', '/api/entries/2026-09-24', { weight: -5 }],
    ['PATCH', '/api/entries/2026-09-24', { meals: { breakfast: 99999999999 } }],
    ['PATCH', '/api/entries/2026-02-30', { weight: 180 }],
    ['PATCH', '/api/entries/2026-09-24', { meals: { breakfast: -300 } }],
    ['PATCH', '/api/entries/2026-09-24', { meals: { breakfast: 12.5 } }],
    ['PATCH', '/api/entries/2026-09-24', { meals: { brunch: 100 } }],
    ['PATCH', '/api/entries/2026-09-24', { weight: 0 }],
  ]) {
    const res = await call(method, url, body);
    assert.equal(res.status, 400, `${method} ${url} ${JSON.stringify(body)}`);
    assert.equal(typeof res.json.error, 'string');
  }
  const { json } = await call('GET', '/api/entries');
  assert.deepEqual(json, []);
});

test('the API applies the same number rules as the app, with the same messages, and never rounds', async (t) => {
  const { call } = await startServer(t);
  const weight = await call('PATCH', '/api/entries/2026-09-24', { weight: 165.123 });
  assert.equal(weight.status, 400);
  assert.equal(weight.json.error, 'Weight not saved. Use at most two decimal places, like 165.25.');
  const lunch = await call('PATCH', '/api/entries/2026-09-24', { meals: { lunch: 450.5 } });
  assert.equal(lunch.status, 400);
  assert.equal(lunch.json.error, 'Lunch not saved. Enter calories as a whole number, like 450, without decimals.');
  const text = await call('PATCH', '/api/entries/2026-09-24', { meals: { lunch: '450' } });
  assert.equal(text.status, 400);

  await call('PATCH', '/api/entries/2026-09-20', { meals: { lunch: 500 } });
  // Nothing in the file can be restored: nothing changes.
  const nothing = await call('POST', '/api/import', { entries: { '2026-09-21': { date: '2026-09-21', weight: null, meals: { lunch: 450.7 } } } });
  assert.equal(nothing.status, 400);
  assert.equal(nothing.json.error, 'Nothing was imported. Lunch on Mon, Sep 21 (450.7): Enter calories as a whole number, like 450, without decimals.');
  const { json } = await call('GET', '/api/entries');
  assert.deepEqual(
    json.map((e) => [e.date, e.meals.lunch]),
    [['2026-09-20', 500]]
  );
});

test('a backup import restores the valid days, lists the ones it left out, and rounds old long weights', async (t) => {
  const { call } = await startServer(t);
  const imported = await call('POST', '/api/import', {
    entries: {
      '2026-09-16': { date: '2026-09-16', weight: 165.333, meals: { breakfast: 300 } },
      '2026-09-20': { date: '2026-09-20', weight: null, meals: { lunch: 600 } },
      '2026-09-21': { date: '2026-09-21', weight: null, meals: { breakfast: -5 } },
    },
  });
  assert.equal(imported.status, 200);
  assert.equal(imported.json.restored, 2);
  assert.deepEqual(imported.json.skipped, ["Breakfast on Mon, Sep 21 (-5): Calories can't be negative. Enter 0 or more."]);
  assert.equal((await call('GET', '/api/entries/2026-09-16')).json.weight, 165.33);
  assert.equal((await call('GET', '/api/entries/2026-09-21')).json.totalCalories, null);
});

test('undoing an import puts the replaced days back exactly and removes the added ones', async (t) => {
  const { call } = await startServer(t);
  const none = await call('POST', '/api/import/undo', {});
  assert.equal(none.status, 400);
  assert.equal(none.json.error, 'There is no restore to undo.');
  await call('PATCH', '/api/entries/2026-09-20', { meals: { breakfast: 700 }, weight: 181.4 });
  await call('POST', '/api/import', {
    entries: {
      '2026-09-20': { date: '2026-09-20', weight: null, meals: { breakfast: 500 } },
      '2026-09-21': { date: '2026-09-21', weight: 180, meals: {} },
    },
  });
  assert.equal((await call('GET', '/api/entries/2026-09-20')).json.meals.breakfast, 500);
  const undone = await call('POST', '/api/import/undo', {});
  assert.equal(undone.status, 200);
  const day = (await call('GET', '/api/entries/2026-09-20')).json;
  assert.equal(day.meals.breakfast, 700);
  assert.equal(day.weight, 181.4);
  const { json } = await call('GET', '/api/entries');
  assert.deepEqual(
    json.map((e) => e.date),
    ['2026-09-20']
  );
  assert.equal((await call('POST', '/api/import/undo', {})).status, 400, 'only once');
});

test('malformed request bodies get a JSON error with no stack trace', async (t) => {
  const { call } = await startServer(t);
  const res = await call('PATCH', '/api/entries/2026-09-24', '', 'not json');
  assert.equal(res.status, 400);
  assert.match(res.type, /json/);
  assert.equal(res.json.error, "The request wasn't valid JSON.");
  assert.doesNotMatch(res.text, /at |node_modules|server\.js/);
  const missing = await call('GET', '/api/nope');
  assert.equal(missing.status, 404);
  assert.equal(typeof missing.json.error, 'string');
});

test('unreadable stored entries are skipped rather than failing the list', async (t) => {
  const { call } = await startServer(t, {
    'entries.json': JSON.stringify({ x: 5, '2026-09-20': { date: '2026-09-20', weight: 170 }, '2026-09-21': 'junk' }),
  });
  const res = await call('GET', '/api/entries');
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.json.map((e) => e.date),
    ['2026-09-20']
  );
});

test('a damaged data file is restored from its backup copy', async (t) => {
  const good = JSON.stringify({ '2026-09-20': { date: '2026-09-20', weight: 170, meals: {} } });
  const { call, dataDir } = await startServer(t, { 'entries.json': '{broken', 'entries.json.bak': good });
  const res = await call('GET', '/api/entries');
  assert.equal(res.status, 200);
  assert.equal(res.json[0].weight, 170);
  assert.ok(fs.readdirSync(dataDir).some((f) => f.startsWith('entries.json.damaged-')));
});

test('a damaged data file with no backup gives a clear error and is never overwritten', async (t) => {
  const { call, dataDir } = await startServer(t, { 'entries.json': '{broken' });
  const res = await call('GET', '/api/entries');
  assert.equal(res.status, 500);
  assert.match(res.json.error, /damaged/);
  const save = await call('PATCH', '/api/entries/2026-09-24', { weight: 180 });
  assert.equal(save.status, 500);
  assert.equal(fs.readFileSync(path.join(dataDir, 'entries.json'), 'utf8'), '{broken');
});

test('import validates everything first and changes nothing on a bad file', async (t) => {
  const { call } = await startServer(t);
  await call('PATCH', '/api/entries/2026-09-01', { weight: 190 });
  const bad = await call('POST', '/api/import', { entries: { '2026-01-01': 5, garbage: { weight: 'x' } } });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /Nothing was imported/);
  const good = await call('POST', '/api/import', {
    entries: { '2026-09-02': { date: '2026-09-02', weight: 189, meals: { dinner: 800 } } },
  });
  assert.equal(good.json.restored, 1);
  const { json } = await call('GET', '/api/entries');
  assert.equal(json.length, 2);
});

test('photos: images are stored, non-images refused, and re-imports never duplicate', async (t) => {
  const { call, base } = await startServer(t);
  const text = await call('POST', '/api/photos', { date: '2026-09-24', dataUrl: `data:image/png;base64,${Buffer.from('hello').toString('base64')}` });
  assert.equal(text.status, 400);
  assert.equal(text.json.error, "That file isn't a photo we can show.");

  const photo = { date: '2026-09-24', createdAt: '2026-09-24T08:00:00.000Z', dataUrl: `data:image/png;base64,${PNG_1PX}` };
  const first = await call('POST', '/api/photos', photo);
  assert.equal(first.status, 200);
  assert.equal(first.json.type, 'image/png');
  assert.match(first.json.filename, /\.png$/);
  const again = await call('POST', '/api/photos', photo);
  assert.equal(again.json.duplicate, true);
  const list = await call('GET', '/api/photos');
  assert.equal(list.json.length, 1);
  const img = await fetch(`${base}/photos/${first.json.filename}`);
  assert.equal(img.status, 200);

  const del = await call('DELETE', `/api/photos/${first.json.id}`);
  assert.equal(del.status, 200);
  assert.equal((await call('DELETE', `/api/photos/${first.json.id}`)).status, 404);
  assert.deepEqual((await call('GET', '/api/photos')).json, []);
});

test('older photo metadata (uploadedAt) is still listed', async (t) => {
  const { call } = await startServer(t, {
    'photos.json': JSON.stringify([{ id: 'a', date: '2026-01-01', filename: 'a.jpg', uploadedAt: '2026-01-01T00:00:00.000Z' }]),
  });
  const { json } = await call('GET', '/api/photos');
  assert.equal(json[0].createdAt, '2026-01-01T00:00:00.000Z');
});

test('the server serves the shared app and switches it to server storage', async (t) => {
  const { base } = await startServer(t);
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /<script type="module" src="build\/app.js"><\/script>/);
  const backend = await (await fetch(`${base}/backend.js`)).text();
  assert.match(backend, /KENNA_BACKEND = 'server'/);
});

test("the server sends the app's files compressed to browsers that accept it", async (t) => {
  const { base } = await startServer(t);
  const compressed = await fetch(`${base}/build/app.js`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(compressed.status, 200);
  assert.equal(compressed.headers.get('content-encoding'), 'gzip');
  assert.match(await compressed.text(), /sourceMappingURL=app\.js\.map/);
  const plain = await fetch(`${base}/build/app.js`, { headers: { 'Accept-Encoding': 'identity' } });
  assert.equal(plain.headers.get('content-encoding'), null);
});

test('only the endpoints the app uses exist', async (t) => {
  const { call } = await startServer(t);
  const res = await call('POST', '/api/entries', { date: '2026-09-24', meals: {} });
  assert.equal(res.status, 404);
});

test('a photo can be moved to another day, but not to a day that has not happened', async (t) => {
  const { call } = await startServer(t);
  const photo = { date: '2026-09-23', createdAt: '2026-09-23T08:00:00.000Z', dataUrl: `data:image/png;base64,${PNG_1PX}` };
  const { json: added } = await call('POST', '/api/photos', photo);
  const moved = await call('PATCH', `/api/photos/${added.id}`, { date: '2026-09-20' });
  assert.equal(moved.status, 200);
  assert.equal(moved.json.date, '2026-09-20');
  assert.equal((await call('GET', '/api/photos')).json[0].date, '2026-09-20');

  assert.equal((await call('PATCH', `/api/photos/${added.id}`, { date: '2026-02-30' })).status, 400);
  const future = await call('PATCH', `/api/photos/${added.id}`, { date: '2999-01-01' });
  assert.equal(future.status, 400);
  assert.match(future.json.error, /hasn't happened yet/);
  assert.equal((await call('PATCH', '/api/photos/nope', { date: '2026-09-20' })).status, 404);

  // Re-importing the photo as it was before the move is recognised as the same photo.
  const again = await call('POST', '/api/photos', photo);
  assert.equal(again.json.duplicate, true);
  assert.equal((await call('GET', '/api/photos')).json.length, 1);
});

test('unknown pages get a plain "Page not found" page that links back to the app', async (t) => {
  const { base } = await startServer(t);
  const res = await fetch(`${base}/nonexistent`);
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /html/);
  const html = await res.text();
  assert.match(html, /Page not found/);
  assert.match(html, /<a class="btn" id="open-kenna" href="[^"]+">Open Kenna<\/a>/);
  assert.doesNotMatch(html, /Cannot GET/);
});

test('days that have not happened yet are refused with a readable message', async (t) => {
  const { call } = await startServer(t);
  const res = await call('PATCH', '/api/entries/2030-01-01', { weight: 150 });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "You can't log a day that hasn't happened yet.");
  const imported = await call('POST', '/api/import', {
    entries: { '2026-09-01': { date: '2026-09-01', weight: 190, meals: {} }, '2030-01-01': { date: '2030-01-01', weight: 150, meals: {} } },
  });
  assert.equal(imported.json.restored, 1);
  assert.equal(imported.json.futureDays, 1);
  assert.deepEqual(
    (await call('GET', '/api/entries')).json.map((e) => e.date),
    ['2026-09-01']
  );
});

test('photos keep a small preview, given on upload or added later, and removed with the photo', async (t) => {
  const { call, base, dataDir } = await startServer(t);
  const png = `data:image/png;base64,${PNG_1PX}`;
  const withThumb = await call('POST', '/api/photos', { date: '2026-09-22', createdAt: '2026-09-22T08:00:00.000Z', dataUrl: png, thumbDataUrl: png });
  assert.equal(withThumb.status, 200);
  assert.match(withThumb.json.thumbFilename, /\.thumb\.png$/);
  assert.equal((await fetch(`${base}/photos/${withThumb.json.thumbFilename}`)).status, 200);

  // A preview that isn't an image is left out; the photo itself is kept.
  const badThumb = await call('POST', '/api/photos', { date: '2026-09-23', dataUrl: png, thumbDataUrl: 'data:image/png;base64,aGVsbG8=' });
  assert.equal(badThumb.status, 200);
  assert.equal(badThumb.json.thumbFilename, undefined);
  const added = await call('PUT', `/api/photos/${badThumb.json.id}/thumb`, { dataUrl: png });
  assert.equal(added.status, 200);
  assert.match(added.json.thumbFilename, /\.thumb\.png$/);
  assert.equal((await call('PUT', `/api/photos/${badThumb.json.id}/thumb`, { dataUrl: 'nope' })).status, 400);
  assert.equal((await call('PUT', '/api/photos/missing/thumb', { dataUrl: png })).status, 404);
  const list = (await call('GET', '/api/photos')).json;
  assert.ok(list.every((p) => typeof p.thumbFilename === 'string'));

  await call('DELETE', `/api/photos/${withThumb.json.id}`);
  assert.equal(fs.existsSync(path.join(dataDir, 'photos', withThumb.json.thumbFilename)), false);
});

test('a photo cannot be uploaded under a day that has not happened yet', async (t) => {
  const { call } = await startServer(t);
  const res = await call('POST', '/api/photos', { date: '2031-01-01', dataUrl: `data:image/png;base64,${PNG_1PX}` });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, "A photo can't be filed under a day that hasn't happened yet.");
  assert.deepEqual((await call('GET', '/api/photos')).json, []);
});

test('a browser opening a missing photo gets the "Page not found" page; the app gets JSON', async (t) => {
  const { base } = await startServer(t);
  const page = await fetch(`${base}/photos/missing.jpg`, { headers: { accept: 'text/html' } });
  assert.equal(page.status, 404);
  assert.match(page.headers.get('content-type'), /html/);
  assert.match(await page.text(), /Page not found/);
  const api = await fetch(`${base}/photos/missing.jpg`);
  assert.equal(api.status, 404);
  assert.equal((await api.json()).error, 'That photo no longer exists.');
});

test('the start-up message gives the network address to open on a phone', () => {
  const interfaces = {
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    wlan0: [
      { address: '192.168.1.23', family: 'IPv4', internal: false },
      { address: 'fe80::1', family: 'IPv6', internal: false },
    ],
  };
  assert.deepEqual(startupAddresses('0.0.0.0', 3000, interfaces), ['http://localhost:3000', 'http://192.168.1.23:3000']);
  assert.deepEqual(startupAddresses('127.0.0.1', 8080, interfaces), ['http://localhost:8080']);
  assert.deepEqual(startupAddresses('192.168.1.23', 3000, interfaces), ['http://192.168.1.23:3000']);
});
