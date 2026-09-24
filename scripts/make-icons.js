// Draws the app's icon, a bathroom scale on the app's dark blue, in every
// size the page and the installed app use:
//
//   docs/favicon.svg                 the browser tab (and the source of the rest)
//   docs/icons/icon-180.png          iPhone Home Screen (square: iOS rounds it)
//   docs/icons/icon-192.png, -512    Android and desktop installs (rounded)
//   docs/icons/icon-maskable-*.png   Android's shaped icons: the scale sits
//                                    inside the middle 80% circle that any
//                                    mask shape keeps
//
// Usage: node scripts/make-icons.js   (needs Playwright's Chromium), then
// npm run build, since the icons are pre-cached for offline use.
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const ICONS = path.join(__dirname, '..', 'docs', 'icons');
const BACKGROUND = '#0f172a';
const GREEN = '#22c55e';

// The scale, on a 64-unit square: its rounded platform, the dial window
// and the needle.
const SCALE = [
  `<rect x="12" y="12" width="40" height="40" rx="11" fill="none" stroke="${GREEN}" stroke-width="4"/>`,
  `<path d="M20 31a12 12 0 0 1 24 0z" fill="${GREEN}"/>`,
  `<path d="M32 31l5.5-8.5" stroke="${BACKGROUND}" stroke-width="2.5" stroke-linecap="round"/>`,
  `<circle cx="32" cy="31" r="2.2" fill="${BACKGROUND}"/>`,
].join('\n  ');

/** @param {{ corner: number, scale?: number }} o corner: the background's corner radius */
function svg(o) {
  const drawing = o.scale ? `<g transform="translate(32 32) scale(${o.scale}) translate(-32 -32)">\n  ${SCALE}\n  </g>` : SCALE;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n  <rect width="64" height="64"${o.corner ? ` rx="${o.corner}"` : ''} fill="${BACKGROUND}"/>\n  ${drawing}\n</svg>\n`;
}

const PNGS = [
  { file: 'icon-180.png', size: 180, corner: 0 },
  { file: 'icon-192.png', size: 192, corner: 14 },
  { file: 'icon-512.png', size: 512, corner: 14 },
  { file: 'icon-maskable-192.png', size: 192, corner: 0, scale: 0.8 },
  { file: 'icon-maskable-512.png', size: 512, corner: 0, scale: 0.8 },
];

async function main() {
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'favicon.svg'), svg({ corner: 14 }));
  const browser = await chromium.launch();
  for (const icon of PNGS) {
    const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size } });
    const data = Buffer.from(svg(icon)).toString('base64');
    await page.setContent(`<style>html,body{margin:0}</style><img src="data:image/svg+xml;base64,${data}" width="${icon.size}" height="${icon.size}">`);
    await page.locator('img').evaluate((img) => /** @type {HTMLImageElement} */ (img).decode());
    await page.screenshot({ path: path.join(ICONS, icon.file), omitBackground: icon.corner > 0 });
    await page.close();
  }
  await browser.close();
  console.log(`Wrote docs/favicon.svg and ${PNGS.length} icons in docs/icons/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
