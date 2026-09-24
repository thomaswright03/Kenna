const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildFiles, CLASSIC_SCRIPTS, appShellFiles, cacheName, currentCacheName } = require('../../scripts/build.js');

const docs = path.join(__dirname, '..', '..', 'docs');

test('the built scripts in docs/build match the sources (run npm run build after changing them)', async () => {
  const built = await buildFiles();
  for (const [name, text] of Object.entries(built)) {
    const file = path.join(docs, name);
    assert.ok(fs.existsSync(file), `docs/${name} is missing: run npm run build`);
    assert.ok(fs.readFileSync(file, 'utf8') === text, `docs/${name} is out of date: run npm run build`);
  }
});

test('the interface bundle is built from every ui module, with a source map back to them', async () => {
  const built = await buildFiles();
  const map = JSON.parse(built['build/app.js.map']);
  const expected = ['../app.js', ...fs.readdirSync(path.join(docs, 'ui')).map((f) => `../ui/${f}`)];
  assert.deepEqual([...map.sources].sort(), expected.sort());
  assert.match(built['build/app.js'], /\/\/# sourceMappingURL=app\.js\.map\n$/);
  assert.doesNotMatch(built['build/app.js'], /^\s*import\s/m, 'nothing is left to fetch separately');
});

test('the data bundle holds the classic scripts in the order the page used to load them', async () => {
  const built = await buildFiles();
  const map = JSON.parse(built['build/data.js.map']);
  // core.js is bundled with its modules in core/; each of the other
  // scripts is its own section.
  assert.deepEqual(
    map.sections.map((s) => s.map.sources.find((src) => !src.startsWith('../core/'))),
    CLASSIC_SCRIPTS.map((name) => `../${name}`)
  );
  const coreModules = fs.readdirSync(path.join(docs, 'core')).map((f) => `../core/${f}`);
  assert.deepEqual([...map.sections[0].map.sources].sort(), ['../core.js', ...coreModules].sort());
  const lines = built['build/data.js'].split('\n');
  for (const section of map.sections) assert.ok(section.offset.line < lines.length);
  // Each script still sets its global when run in a page.
  const window = {};
  new Function('self', 'window', built['build/data.js'])(window, window);
  for (const name of ['KennaCore', 'KennaLocalStore', 'KennaBackupFile']) assert.ok(name in window, `${name} is set`);
});

test('the rules shared by the app and the tests are split into modules of a readable size', () => {
  const files = ['core.js', ...fs.readdirSync(path.join(docs, 'core')).map((f) => `core/${f}`)];
  assert.ok(files.length >= 8);
  for (const file of files) {
    const lines = fs.readFileSync(path.join(docs, file), 'utf8').split('\n').length;
    assert.ok(lines <= 400, `${file} has ${lines} lines`);
  }
});

test('the page and Node get the same rules', async () => {
  const built = await buildFiles();
  const window = {};
  new Function('self', 'window', built['build/data.js'])(window, window);
  const core = require('../../docs/core.js');
  assert.deepEqual(Object.keys(window.KennaCore).sort(), Object.keys(core).sort());
  assert.ok(Object.isFrozen(window.KennaCore));
  assert.equal(window.KennaCore.formatWeight(165.25), core.formatWeight(165.25));
});

test("the service worker's cache is named after the files it pre-caches (run npm run build after changing one)", () => {
  assert.equal(currentCacheName(), cacheName(), "docs/sw.js's CACHE_NAME doesn't match the app's files: run npm run build");
});

test('changing any pre-cached file changes the cache name', () => {
  const shell = appShellFiles(fs.readFileSync(path.join(docs, 'sw.js'), 'utf8'));
  assert.ok(shell.includes('style.css') && shell.includes('index.html') && shell.includes('build/app.js'));
  const now = cacheName();
  assert.match(now, /^kenna-[0-9a-f]{12}$/);
  const names = new Set([now]);
  for (const file of shell) {
    const text = fs.readFileSync(path.join(docs, file), 'utf8');
    names.add(cacheName({ [file]: `${text} ` }));
  }
  assert.equal(names.size, shell.length + 1, 'each file changes the name');
  assert.equal(cacheName(), now, 'the same files give the same name');
});
