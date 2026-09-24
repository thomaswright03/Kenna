const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const docs = path.join(__dirname, '..', '..', 'docs');

function appShell() {
  const sw = fs.readFileSync(path.join(docs, 'sw.js'), 'utf8');
  return JSON.parse(sw.match(/const APP_SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
}

// Every file the page loads: its scripts and stylesheets, plus every module
// those scripts import (followed recursively).
function loadedFiles() {
  const html = fs.readFileSync(path.join(docs, 'index.html'), 'utf8');
  const found = new Set();
  const queue = [...html.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css|webmanifest|svg|png))"/g)].map((m) => m[1]);
  while (queue.length) {
    const file = path.posix.normalize(queue.shift());
    if (found.has(file)) continue;
    found.add(file);
    if (!file.endsWith('.js')) continue;
    const source = fs.readFileSync(path.join(docs, file), 'utf8');
    for (const m of source.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+'(\.[^']+)'|^\s*import\s+'(\.[^']+)'/gm)) {
      queue.push(path.posix.join(path.posix.dirname(file), m[1] || m[2]));
    }
  }
  return [...found];
}

test('every file the service worker pre-caches exists', () => {
  for (const file of appShell()) {
    const p = file === './' ? 'index.html' : file.replace('./', '');
    assert.ok(fs.existsSync(path.join(docs, p)), `${file} is missing`);
  }
});

test('every script, module and stylesheet the page loads is pre-cached for offline use', () => {
  const shell = appShell();
  const files = loadedFiles();
  assert.ok(files.length >= 6);
  assert.ok(files.includes('ui/screen-today.js'), 'imports are followed');
  for (const file of files) assert.ok(shell.includes(`./${file}`), `${file} is not in the service worker's APP_SHELL`);
});

test('no UI source file is longer than a few hundred lines', () => {
  const files = ['app.js', ...fs.readdirSync(path.join(docs, 'ui')).map((f) => `ui/${f}`)];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(docs, file), 'utf8').split('\n').length;
    assert.ok(lines <= 400, `${file} has ${lines} lines`);
  }
});

test('the page allows pinch-zoom', () => {
  const html = fs.readFileSync(path.join(docs, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /maximum-scale|user-scalable=no/);
});
