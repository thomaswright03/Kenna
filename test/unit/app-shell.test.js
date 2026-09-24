const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const docs = path.join(__dirname, '..', '..', 'docs');

test('every file the service worker pre-caches exists', () => {
  const sw = fs.readFileSync(path.join(docs, 'sw.js'), 'utf8');
  const list = JSON.parse(sw.match(/const APP_SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
  for (const file of list) {
    const p = file === './' ? 'index.html' : file.replace('./', '');
    assert.ok(fs.existsSync(path.join(docs, p)), `${file} is missing`);
  }
});

test('every script and stylesheet the page loads is pre-cached for offline use', () => {
  const html = fs.readFileSync(path.join(docs, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(docs, 'sw.js'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css|webmanifest|svg|png))"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 6);
  for (const ref of refs) assert.ok(sw.includes(`'./${ref}'`), `${ref} is not in the service worker's APP_SHELL`);
});

test('the page allows pinch-zoom', () => {
  const html = fs.readFileSync(path.join(docs, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /maximum-scale|user-scalable=no/);
});
