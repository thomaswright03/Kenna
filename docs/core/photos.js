// Photo files: recognising the image type from the bytes, and base64 for
// backup files and uploads.
'use strict';

// Recognises the image formats a phone camera or browser produces from the
// first bytes of the file, independent of its name or claimed type.
/** @param {Uint8Array | null | undefined} bytes @returns {string | null} */
function sniffImageType(bytes) {
  if (!bytes || bytes.length < 12) return null;
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  /** @param {number} from @param {number} to */
  const ascii = (from, to) => String.fromCharCode(...Array.from(b.slice(from, to)));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(brand)) return 'image/heic';
    if (brand === 'mif1' || brand === 'msf1') return 'image/heif';
  }
  return null;
}

// A photo's bytes as base64, for backup files and uploads to the server.
// Encoded in slices so a large photo never needs one huge argument list.
/** @param {Blob} blob @returns {Promise<string>} */
async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const SLICE = 0x2000;
  /** @type {string[]} */
  const parts = [];
  for (let i = 0; i < bytes.length; i += SLICE) parts.push(String.fromCharCode(...bytes.subarray(i, i + SLICE)));
  return btoa(parts.join(''));
}

/** @type {Record<string, string>} */
const IMAGE_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

module.exports = {
  sniffImageType,
  blobToBase64,
  IMAGE_EXTENSIONS,
};
