// Turning a picked file into the photo Kenna stores, and making the small
// preview shown in the Photos grid.

import { core, h } from './dom.js';

/** @param {Blob} file @param {number} n */
function readHead(file, n) {
  return file
    .slice(0, n)
    .arrayBuffer()
    .then((buf) => new Uint8Array(buf));
}

/**
 * @param {Blob} file
 * @returns {Promise<{ img: HTMLImageElement, release: () => void } | null>}
 */
function decodeImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => resolve({ img, release: () => URL.revokeObjectURL(url) });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * Draws the image no larger than `maxDim` on either side and encodes it as
 * JPEG; null when it can't be drawn or encoded.
 * @param {HTMLImageElement} img
 * @param {number} maxDim
 * @param {number} quality
 * @returns {Promise<Blob | null>}
 */
async function scaleToJpeg(img, maxDim, quality) {
  let { naturalWidth: w, naturalHeight: hgt } = img;
  if (!w || !hgt) return null;
  if (w > maxDim || hgt > maxDim) {
    const scale = maxDim / Math.max(w, hgt);
    w = Math.max(1, Math.round(w * scale));
    hgt = Math.max(1, Math.round(hgt * scale));
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(img, 0, 0, w, hgt);
  const blob = await new Promise((/** @type {(b: Blob | null) => void} */ resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  // Frees the canvas's pixels straight away (Safari keeps them otherwise).
  canvas.width = 0;
  canvas.height = 0;
  return blob;
}

/**
 * Downscales and re-encodes so a multi-megabyte phone photo doesn't eat
 * storage. A real photo format this browser can't draw or re-encode (e.g.
 * HEIC in most browsers other than Safari) is kept as-is, with `viewable`
 * false; anything that isn't an image is refused.
 * @param {Blob} file
 * @param {number} maxDim
 * @returns {Promise<{ blob: Blob, viewable: boolean }>}
 */
export async function preparePhoto(file, maxDim) {
  const sniffed = core.sniffImageType(await readHead(file, 32));
  const decoded = await decodeImage(file);
  if (!decoded) {
    if (sniffed) return { blob: new Blob([file], { type: sniffed }), viewable: false };
    throw new core.InputError("That file isn't a photo we can show.");
  }
  const blob = await scaleToJpeg(decoded.img, maxDim, 0.85);
  decoded.release();
  if (blob) return { blob, viewable: true };
  if (sniffed) return { blob: new Blob([file], { type: sniffed }), viewable: true };
  throw new core.InputError("That file isn't a photo we can show.");
}

// What the Photos grid shows for a photo this browser can't draw.
export const CANT_PREVIEW = "Can't preview in this browser";

/**
 * Shown in the viewer and in Compare photos in place of a photo this
 * browser can't draw, which is still stored and backed up as it is.
 * @param {string} label names the photo, e.g. "Progress photo, Thu, Sep 24"
 */
export function unviewablePhoto(label) {
  return h(
    'div',
    { class: 'photo-unviewable', role: 'img', 'aria-label': `${label}: ${CANT_PREVIEW.toLowerCase()}` },
    h('p', { class: 'photo-unviewable-title', text: CANT_PREVIEW }),
    h('p', { class: 'photo-unviewable-text', text: 'The photo is saved as it is and included in backups.' })
  );
}

// Grid cells are about 120 CSS pixels wide; 360 pixels stays sharp on a
// 3x phone screen at a few tens of kilobytes.
const THUMB_SIZE = 360;

/**
 * A small preview of a stored photo, or null when this browser can't draw it.
 * @param {Blob} photo
 * @returns {Promise<Blob | null>}
 */
export async function makeThumbnail(photo) {
  const decoded = await decodeImage(photo);
  if (!decoded) return null;
  try {
    return await scaleToJpeg(decoded.img, THUMB_SIZE, 0.8);
  } finally {
    decoded.release();
  }
}
