const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildFiles, CLASSIC_SCRIPTS } = require('../../scripts/build.js');

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
  assert.deepEqual(
    map.sections.map((s) => s.map.sources[0]),
    CLASSIC_SCRIPTS.map((name) => `../${name}`)
  );
  const lines = built['build/data.js'].split('\n');
  for (const section of map.sections) assert.ok(section.offset.line < lines.length);
  // Each script still sets its global when run in a page.
  const window = {};
  new Function('self', 'window', built['build/data.js'])(window, window);
  for (const name of ['KennaCore', 'KennaLocalStore', 'KennaServerStore', 'KennaBackupFile']) assert.ok(name in window, `${name} is set`);
});
