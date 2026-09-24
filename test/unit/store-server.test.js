const test = require('node:test');
const assert = require('node:assert/strict');
const { createServerStore, NOT_RESPONDING } = require('../../docs/store-server.js');

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
