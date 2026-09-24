// Progress photos, grouped by the day they're filed under.

import { core, h, uid, BACKEND, today, errorText } from './dom.js';
import { toast, openDialog, confirmDialog } from './feedback.js';
import { store } from './store.js';
import { render } from './render.js';

/** @typedef {import('../store-local.js').Photo} Photo */

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
 * Downscales and re-encodes so a multi-megabyte phone photo doesn't eat
 * storage. A real photo format this browser can't re-encode (e.g. HEIC in
 * some browsers) is kept as-is; anything that isn't an image is refused.
 * @param {Blob} file
 * @param {number} maxDim
 * @returns {Promise<Blob>}
 */
async function preparePhoto(file, maxDim) {
  const sniffed = core.sniffImageType(await readHead(file, 32));
  const decoded = await decodeImage(file);
  if (!decoded) {
    if (sniffed) return new Blob([file], { type: sniffed });
    throw new Error("That file isn't a photo we can show.");
  }
  const { img, release } = decoded;
  let { naturalWidth: w, naturalHeight: hgt } = img;
  if (!w || !hgt) {
    release();
    throw new Error("That file isn't a photo we can show.");
  }
  if (w > maxDim || hgt > maxDim) {
    const scale = maxDim / Math.max(w, hgt);
    w = Math.round(w * scale);
    hgt = Math.round(hgt * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  const context = canvas.getContext('2d');
  if (context) context.drawImage(img, 0, 0, w, hgt);
  release();
  /** @type {Blob | null} */
  const blob = context ? await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85)) : null;
  if (blob) return blob;
  if (sniffed) return new Blob([file], { type: sniffed });
  throw new Error("That file isn't a photo we can show.");
}

/** @type {import('./render.js').ScreenBuilder} */
export async function buildPhotos(ctx) {
  const now = today();
  const photos = await store.listPhotos();
  const where = BACKEND === 'server' ? 'on the Kenna server' : 'on this device';

  const status = h('p', { class: 'field-status', role: 'status' });
  const fileInput = h('input', { type: 'file', accept: 'image/*,.heic,.heif', class: 'visually-hidden', id: uid('upload') });
  const uploadLabel = h('label', { class: 'btn btn-primary file-btn', for: fileInput.id, text: 'Add Photo' });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    status.className = 'field-status is-pending';
    status.textContent = 'Saving photo…';
    try {
      const blob = await preparePhoto(file, 1600);
      await store.addPhoto({ date: today(), blob, createdAt: new Date().toISOString() });
      toast('Photo added');
      render();
    } catch (err) {
      status.className = 'field-status is-error';
      status.textContent = err instanceof Error && err.message ? err.message : "Couldn't save that photo. Try again.";
    }
  });

  const intro = h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card-title', text: 'Progress Photos' }),
    h('p', {
      class: 'card-sub',
      text: `Each photo is filed under the day you add it (today is ${core.formatDate(now, now)}). Photos are kept ${where} and are included in your backup file.`,
    }),
    fileInput,
    uploadLabel,
    status
  );

  const stack = h('div', { class: 'screen-stack' }, intro);
  if (photos.length === 0) {
    stack.append(h('section', { class: 'card' }, h('p', { class: 'empty-hint', text: 'No photos yet.' })));
    return { root: stack };
  }

  /** @type {{ date: string, items: Photo[] }[]} */
  const groups = [];
  for (const p of photos) {
    let group = groups.find((g) => g.date === p.date);
    if (!group) {
      group = { date: p.date, items: [] };
      groups.push(group);
    }
    group.items.push(p);
  }
  groups.sort((a, b) => (a.date < b.date ? 1 : -1));

  for (const group of groups) {
    const dateLabel = core.formatRelativeDate(group.date, now);
    const grid = h('div', { class: 'photo-grid' });
    for (const p of group.items) {
      const src = store.photoSrc(p);
      ctx.onRelease(src.release);
      const img = h('img', { src: src.url, alt: `Progress photo, ${core.formatDate(p.date, now)}`, loading: 'lazy' });
      img.addEventListener('error', () => img.replaceWith(h('span', { class: 'photo-missing', text: "Can't preview in this browser" })));
      const thumb = h('button', { type: 'button', class: 'photo-thumb', 'data-photo': String(p.id) }, img);
      thumb.addEventListener('click', () => openPhotoViewer(p));
      grid.append(thumb);
    }
    stack.append(h('section', { class: 'card' }, h('h3', { class: 'section-title', text: dateLabel }), grid));
  }
  return { root: stack };
}

/** @param {Photo} photo */
function openPhotoViewer(photo) {
  const now = today();
  const dateText = core.formatDate(photo.date, now);
  const labelId = uid('photo');
  const src = store.photoSrc(photo);
  const closeBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Close' });
  const deleteBtn = h('button', { type: 'button', class: 'btn btn-danger-outline', text: 'Delete…' });
  const content = h(
    'div',
    { class: 'viewer' },
    h('h2', { id: labelId, class: 'viewer-title', text: `Progress photo, ${dateText}` }),
    h('img', { src: src.url, alt: `Progress photo, ${dateText}`, class: 'viewer-img' }),
    h('div', { class: 'viewer-bar' }, deleteBtn, closeBtn)
  );
  const close = openDialog({ labelId, content, className: 'dialog-viewer', initialFocus: closeBtn, onClose: src.release });
  closeBtn.addEventListener('click', () => close());
  deleteBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: `Delete this photo from ${dateText}?`,
      message: "It will be removed from Kenna for good. This can't be undone.",
      confirmLabel: 'Delete photo',
      danger: true,
    });
    if (!ok) return;
    try {
      await store.deletePhoto(photo.id);
      close();
      toast('Photo deleted');
      render();
    } catch (err) {
      toast(`Photo not deleted. ${errorText(err)}`, { tone: 'error' });
    }
  });
}
