// Measures which code the tests run, in one report: the unit tests (Node)
// and the browser tests (the phone app in Chromium, whose pages record
// which parts of the built scripts ran; see test/e2e/fixtures.js). The
// built files are mapped back to their sources through their source maps,
// so the report lists docs/app.js, docs/ui/*.js, docs/store-local.js and
// the rest one by one.
//
// Usage: npm run coverage           unit and browser tests
//        npm run coverage -- --unit unit tests only (quick)
// The HTML report is written to coverage/index.html.
//
// The browser tests run an unminified build, which maps back to the sources
// line by line (a minified file is one long line); the usual minified build
// is put back at the end. If a run is stopped part-way, npm run build puts
// it back.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const v8toIstanbul = require('v8-to-istanbul');
const libCoverage = require('istanbul-lib-coverage');
const libReport = require('istanbul-lib-report');
const reports = require('istanbul-reports');
const { AnyMap, decodedMappings } = require('@jridgewell/trace-mapping');
const { encode } = require('@jridgewell/sourcemap-codec');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'coverage');
const NODE_RAW = path.join(OUT, 'node-raw');
const PAGE_RAW = path.join(OUT, 'page-raw');
const unitOnly = process.argv.includes('--unit');

/** @param {string} command @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
function run(command, args, env) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env }, shell: process.platform === 'win32' });
  return result.status === 0;
}

/**
 * A built file and its source map, as v8-to-istanbul reads it: with the
 * sources resolved to files on disk and their text included.
 * @type {Map<string, { source: string, sourceMap: { sourcemap: object } }>}
 */
const builtFiles = new Map();
/** @param {string} file */
function builtFile(file) {
  let found = builtFiles.get(file);
  if (!found) {
    const map = new AnyMap(JSON.parse(fs.readFileSync(`${file}.map`, 'utf8')), `${file}.map`);
    const sources = map.resolvedSources.map((s) => path.resolve(path.dirname(file), s.replace(/^file:\/\//, '')));
    const sourcemap = {
      version: 3,
      file: path.basename(file),
      sources,
      sourcesContent: sources.map((s) => fs.readFileSync(s, 'utf8')),
      names: map.names,
      mappings: encode(decodedMappings(map)),
    };
    found = { source: fs.readFileSync(file, 'utf8'), sourceMap: { sourcemap } };
    builtFiles.set(file, found);
  }
  return found;
}

/**
 * Every page's coverage of the built scripts, as coverage of the sources.
 * @param {import('istanbul-lib-coverage').CoverageMap} coverage
 */
async function addPageCoverage(coverage) {
  if (!fs.existsSync(PAGE_RAW)) return;
  for (const name of fs.readdirSync(PAGE_RAW)) {
    const { result } = JSON.parse(fs.readFileSync(path.join(PAGE_RAW, name), 'utf8'));
    for (const script of result) {
      const file = new URL(script.url).pathname;
      const converter = v8toIstanbul(file, 0, builtFile(file));
      await converter.load();
      converter.applyCoverage(script.functions);
      coverage.merge(converter.toIstanbul());
    }
  }
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(NODE_RAW, { recursive: true });

  let ok = run(process.execPath, ['--test', 'test/unit/*.test.js'], { NODE_V8_COVERAGE: NODE_RAW });
  if (!unitOnly) {
    ok = run(process.execPath, ['scripts/build.js', '--no-minify']) && ok;
    // The pages are measured by the fixture.
    ok = run('npx', ['playwright', 'test', '--project', 'phone-app'], { NODE_V8_COVERAGE: NODE_RAW, KENNA_COVERAGE: PAGE_RAW }) && ok;
  }

  // What ran in Node, from c8, then what ran in the pages.
  const nodeJson = path.join(OUT, 'node');
  run('npx', ['c8', 'report', '--temp-directory', NODE_RAW, '--report-dir', nodeJson, '--reporter', 'json', '--include', 'docs/*.js', '--include', 'docs/core/*.js', '--exclude', 'docs/sw.js']);
  const coverage = libCoverage.createCoverageMap(JSON.parse(fs.readFileSync(path.join(nodeJson, 'coverage-final.json'), 'utf8')));
  await addPageCoverage(coverage);

  if (!unitOnly && !run(process.execPath, ['scripts/build.js'])) {
    console.error('The minified build could not be put back: run npm run build.');
    ok = false;
  }

  const context = libReport.createContext({ dir: OUT, coverageMap: coverage, defaultSummarizer: 'nested' });
  reports.create('text').execute(context);
  reports.create('html').execute(context);
  console.log(`HTML report: ${path.relative(ROOT, path.join(OUT, 'index.html'))}`);
  if (!ok) console.error('Some tests failed, so the numbers above are incomplete.');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  run(process.execPath, ['scripts/build.js']);
  process.exit(1);
});
