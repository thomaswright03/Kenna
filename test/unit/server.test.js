const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../../server.js');

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
  assert.match(html, /<script src="app.js"><\/script>/);
  const backend = await (await fetch(`${base}/backend.js`)).text();
  assert.match(backend, /KENNA_BACKEND = 'server'/);
});

test('only the endpoints the app uses exist', async (t) => {
  const { call } = await startServer(t);
  const res = await call('POST', '/api/entries', { date: '2026-09-24', meals: {} });
  assert.equal(res.status, 404);
});
