// Builds the two script files the page loads, from the sources in docs/:
//
//   docs/build/data.js  the classic scripts (core.js with its modules in
//                       core/, store-local.js, backup-file.js), each
//                       minified, in that order
//   docs/build/app.js   app.js and every ui/ module it imports, as one
//                       minified ES module
//
// each with a source map that points back at the source files. Loading two
// files instead of thirty is what makes the first visit quick on a slow
// connection. The built files are committed, because Pages serves docs/ as
// it is; a unit test fails when they don't match the sources.
//
// It then names the service worker's cache (CACHE_NAME in docs/sw.js)
// after a hash of every file the worker pre-caches (its APP_SHELL), so any
// change to one of them, a rebuilt script or an edited stylesheet, gives
// the worker a new cache name and phones pre-cache the new set together.
//
// Usage: npm run build            build once
//        npm run build:watch       rebuild whenever a source file changes
//        node scripts/build.js --no-minify
//                                  the same files unminified, which npm run
//                                  coverage measures (line by line), then
//                                  replaces with the minified build
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const DOCS = path.join(__dirname, '..', 'docs');
const OUT_DIR = path.join(DOCS, 'build');
const CLASSIC_SCRIPTS = ['core.js', 'store-local.js', 'backup-file.js'];
// The syntax the sources are written in (see tsconfig.json), left as it is.
const TARGET = 'es2022';
const MINIFY = !process.argv.includes('--no-minify');

/** @param {string} text */
const lineCount = (text) => text.split('\n').length - 1;

/**
 * One classic script (it sets its own global), minified.
 * @param {string} name
 * @returns {Promise<{ code: string, map: string }>}
 */
async function transformClassic(name) {
  const source = fs.readFileSync(path.join(DOCS, name), 'utf8');
  return esbuild.transform(source, {
    minify: MINIFY,
    target: TARGET,
    charset: 'utf8',
    legalComments: 'none',
    sourcemap: 'external',
    sourcesContent: false,
    sourcefile: `../${name}`,
  });
}

/**
 * core.js and the modules in core/ it's made of, as one script that sets
 * self.KennaCore (Node requires core.js as it is).
 * @returns {Promise<{ code: string, map: string }>}
 */
async function buildCore() {
  const result = await esbuild.build({
    entryPoints: [path.join(DOCS, 'core', 'global.js')],
    outfile: path.join(OUT_DIR, 'data.js'),
    bundle: true,
    format: 'iife',
    minify: MINIFY,
    target: TARGET,
    charset: 'utf8',
    legalComments: 'none',
    sourcemap: 'external',
    sourcesContent: false,
    write: false,
    logLevel: 'silent',
  });
  const file = (/** @type {string} */ ext) => {
    const found = result.outputFiles.find((f) => f.path.endsWith(ext));
    if (!found) throw new Error(`esbuild wrote no ${ext} file`);
    return found.text;
  };
  return { code: file('data.js'), map: file('data.js.map') };
}

/**
 * The classic scripts, minified one by one and joined, with an index source
 * map that has one section per script.
 * @returns {Promise<{ code: string, map: string }>}
 */
async function buildClassic() {
  let code = '';
  const sections = [];
  for (const name of CLASSIC_SCRIPTS) {
    const result = name === 'core.js' ? await buildCore() : await transformClassic(name);
    sections.push({ offset: { line: lineCount(code), column: 0 }, map: JSON.parse(result.map) });
    code += result.code.endsWith('\n') ? result.code : `${result.code}\n`;
  }
  code += '//# sourceMappingURL=data.js.map\n';
  return { code, map: `${JSON.stringify({ version: 3, file: 'data.js', sections })}\n` };
}

/**
 * The interface: app.js and its imports, bundled.
 * @returns {Promise<{ code: string, map: string }>}
 */
async function buildApp() {
  const result = await esbuild.build({
    entryPoints: [path.join(DOCS, 'app.js')],
    outfile: path.join(OUT_DIR, 'app.js'),
    bundle: true,
    format: 'esm',
    minify: MINIFY,
    target: TARGET,
    charset: 'utf8',
    legalComments: 'none',
    sourcemap: 'linked',
    sourcesContent: false,
    write: false,
    logLevel: 'silent',
  });
  const file = (/** @type {string} */ ext) => {
    const found = result.outputFiles.find((f) => f.path.endsWith(ext));
    if (!found) throw new Error(`esbuild wrote no ${ext} file`);
    return found.text;
  };
  return { code: file('app.js'), map: file('app.js.map') };
}

/**
 * Every built file, by its path under docs/, with its contents.
 * @returns {Promise<Record<string, string>>}
 */
async function buildFiles() {
  const [classic, app] = await Promise.all([buildClassic(), buildApp()]);
  return {
    'build/data.js': classic.code,
    'build/data.js.map': classic.map,
    'build/app.js': app.code,
    'build/app.js.map': app.map,
  };
}

const SW_FILE = path.join(DOCS, 'sw.js');
const CACHE_NAME_LINE = /^const CACHE_NAME = '([^']*)';$/m;

/**
 * The files the service worker pre-caches, as paths under docs/ ('./' is
 * index.html).
 * @param {string} sw the worker's source
 * @returns {string[]}
 */
function appShellFiles(sw) {
  const list = /const APP_SHELL = \[([\s\S]*?)\];/.exec(sw);
  if (!list) throw new Error('docs/sw.js has no APP_SHELL list');
  const files = [...list[1].matchAll(/'([^']+)'/g)].map((m) => (m[1] === './' ? 'index.html' : m[1].replace(/^\.\//, '')));
  return [...new Set(files)].sort();
}

/**
 * The cache name for the files as they are now: "kenna-" and a hash of
 * each pre-cached file's path and contents. `overrides` stands in for
 * files not written yet (a build that is about to be written).
 * @param {Record<string, string>} [overrides] contents by path under docs/
 */
function cacheName(overrides) {
  const hash = crypto.createHash('sha256');
  for (const file of appShellFiles(fs.readFileSync(SW_FILE, 'utf8'))) {
    const override = overrides && overrides[file];
    hash.update(`${file}\0`);
    hash.update(override !== undefined ? override : fs.readFileSync(path.join(DOCS, file)));
    hash.update('\0');
  }
  return `kenna-${hash.digest('hex').slice(0, 12)}`;
}

/** The cache name docs/sw.js has now. */
function currentCacheName() {
  const found = CACHE_NAME_LINE.exec(fs.readFileSync(SW_FILE, 'utf8'));
  if (!found) throw new Error("docs/sw.js has no line const CACHE_NAME = '…';");
  return found[1];
}

/** Writes the cache name for the current files into docs/sw.js, if it changed. */
function stampCacheName() {
  const sw = fs.readFileSync(SW_FILE, 'utf8');
  const name = cacheName();
  const next = sw.replace(CACHE_NAME_LINE, `const CACHE_NAME = '${name}';`);
  if (next !== sw) fs.writeFileSync(SW_FILE, next);
  return name;
}

async function writeBuild() {
  const files = await buildFiles();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(DOCS, name);
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text);
  }
  stampCacheName();
  return files;
}

/** @param {Record<string, string>} files */
function report(files) {
  const sizes = Object.entries(files)
    .filter(([name]) => name.endsWith('.js'))
    .map(([name, text]) => `docs/${name} ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB`);
  console.log(`Built ${sizes.join(', ')}`);
}

function watch() {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const rebuild = () => {
    writeBuild()
      .then(report)
      .catch((err) => console.error(err.message));
  };
  // A changed script is rebuilt; a changed stylesheet, page or icon only
  // needs a new cache name.
  const shell = appShellFiles(fs.readFileSync(SW_FILE, 'utf8'));
  fs.watch(DOCS, { recursive: true }, (event, name) => {
    if (!name || name.startsWith('build') || name === 'sw.js') return;
    const file = name.split(path.sep).join('/');
    if (!file.endsWith('.js') && !shell.includes(file)) return;
    clearTimeout(timer);
    timer = setTimeout(rebuild, 100);
  });
  rebuild();
  console.log('Watching docs/ for changes (Ctrl+C to stop)');
}

if (require.main === module) {
  if (process.argv.includes('--watch')) watch();
  else
    writeBuild()
      .then(report)
      .catch((err) => {
        console.error(err.message);
        process.exit(1);
      });
}

module.exports = { buildFiles, CLASSIC_SCRIPTS, appShellFiles, cacheName, currentCacheName };
