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

test('colours are set only in the light and dark theme tokens', () => {
  const css = fs.readFileSync(path.join(docs, 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const tokenBlocks = /^:root(\[data-theme='dark'\])? \{[\s\S]*?^\}/gm;
  assert.equal((css.match(tokenBlocks) || []).length, 2);
  const outside = css.replace(tokenBlocks, '');
  const colours = outside.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g) || [];
  assert.deepEqual(colours, []);
});

// Reads an 8-bit RGB or RGBA, non-interlaced PNG into rows of pixels.
function readPng(file) {
  const zlib = require('node:zlib');
  const buf = fs.readFileSync(file);
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, '8-bit');
      channels = { 2: 3, 6: 4 }[data[9]];
      assert.ok(channels, 'RGB or RGBA');
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      out[y * stride + x] = (v + [0, a, b, (a + b) >> 1, paeth][filter]) & 255;
    }
  }
  return { width, height, pixel: (x, y) => Array.from(out.subarray(y * stride + x * channels, y * stride + x * channels + channels)) };
}

test('the manifest lists plain and maskable icons separately, with maskable artwork inside the safe zone', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(docs, 'manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons) {
    assert.ok(['any', 'maskable'].includes(icon.purpose), `${icon.src}: one purpose, not "${icon.purpose}"`);
    assert.ok(fs.existsSync(path.join(docs, icon.src)), icon.src);
    assert.ok(appShell().includes(`./${icon.src}`), `${icon.src} is cached for offline use`);
  }
  const maskable = manifest.icons.filter((i) => i.purpose === 'maskable');
  assert.ok(maskable.some((i) => i.sizes === '512x512') && maskable.some((i) => i.sizes === '192x192'));
  for (const icon of maskable) {
    const png = readPng(path.join(docs, icon.src));
    assert.equal(`${png.width}x${png.height}`, icon.sizes);
    // Full bleed: every pixel outside the central circle (40% of the size
    // in radius, the part every mask keeps) is the plain background.
    const background = png.pixel(0, 0).slice(0, 3).join();
    const r = png.width * 0.4;
    for (let y = 0; y < png.height; y += 2) {
      for (let x = 0; x < png.width; x += 2) {
        if (Math.hypot(x + 0.5 - png.width / 2, y + 0.5 - png.height / 2) <= r) continue;
        assert.equal(png.pixel(x, y).slice(0, 3).join(), background, `${icon.src} has artwork outside the safe zone at ${x},${y}`);
      }
    }
  }
});
