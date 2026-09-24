// Builds the two script files the page loads, from the sources in docs/:
//
//   docs/build/data.js  the classic scripts (core.js with its modules in
//                       core/, store-local.js, store-server.js,
//                       backup-file.js), each minified, in that order
//   docs/build/app.js   app.js and every ui/ module it imports, as one
//                       minified ES module
//
// each with a source map that points back at the source files. Loading two
// files instead of thirty is what makes the first visit quick on a slow
// connection. The built files are committed, because Pages serves docs/ as
// it is; a unit test fails when they don't match the sources.
//
// Usage: npm run build            build once
//        npm run build:watch       rebuild whenever a source file changes
//        node scripts/build.js --no-minify
//                                  the same files unminified, which npm run
//                                  coverage measures (line by line), then
//                                  replaces with the minified build
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const DOCS = path.join(__dirname, '..', 'docs');
const OUT_DIR = path.join(DOCS, 'build');
const CLASSIC_SCRIPTS = ['core.js', 'store-local.js', 'store-server.js', 'backup-file.js'];
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

async function writeBuild() {
  const files = await buildFiles();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(DOCS, name), text);
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
  fs.watch(DOCS, { recursive: true }, (event, name) => {
    if (!name || !name.endsWith('.js') || name.startsWith('build')) return;
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

module.exports = { buildFiles, CLASSIC_SCRIPTS };
