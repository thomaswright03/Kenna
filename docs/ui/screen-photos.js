// Progress photos, grouped by the day they're filed under. A photo opens in
// the viewer (photo-viewer.js); Compare photos puts two side by side
// (photo-compare.js).

import { core, h, uid, BACKEND, today, errorText } from './dom.js';
import { toast, createStatusLine, announce } from './feedback.js';
import { store } from './store.js';
import { render } from './render.js';
import { preparePhoto, makeThumbnail, CANT_PREVIEW } from './photo-image.js';
import { openPhotoViewer, photoDayProblem } from './photo-viewer.js';
import { openPhotoCompare } from './photo-compare.js';

/** @typedef {import('../store-local.js').Photo} Photo */

/** The card with the day picker and Add Photo. */
function buildAddCard() {
  const now = today();
  const where = BACKEND === 'server' ? 'on the Kenna server' : 'on this device';
  const status = createStatusLine();
  const dayInput = h('input', { type: 'date', id: uid('photo-day'), value: now, max: now, required: true });
  const fileInput = h('input', { type: 'file', accept: 'image/*,.heic,.heif', class: 'visually-hidden', id: uid('upload') });
  const uploadLabel = h('label', { class: 'btn btn-primary file-btn', for: fileInput.id, text: 'Add Photo' });

  // While a photo is being saved, Add Photo can't start another.
  /** @param {boolean} on */
  function busy(on) {
    fileInput.disabled = on;
    dayInput.disabled = on;
    uploadLabel.classList.toggle('is-disabled', on);
    uploadLabel.setAttribute('aria-disabled', on ? 'true' : 'false');
    uploadLabel.textContent = on ? 'Adding photo…' : 'Add Photo';
  }

  dayInput.addEventListener('change', () => {
    const problem = photoDayProblem(dayInput.value);
    if (!problem) return;
    dayInput.value = now;
    status.set('error', problem);
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const day = dayInput.value || now;
    const problem = photoDayProblem(day);
    if (problem) return status.set('error', problem);
    status.set('pending', 'Saving photo…');
    busy(true);
    try {
      const { blob, viewable } = await preparePhoto(file, 1600);
      const thumb = viewable ? await makeThumbnail(blob).catch(() => null) : null;
      await store.addPhoto({ date: day, blob, thumb, createdAt: new Date().toISOString() });
      const added = day === today() ? 'Photo added' : `Photo added to ${core.formatRelativeDate(day)}`;
      toast(viewable ? added : `${added}. It's saved, but this browser can't show this kind of photo, so it can't be previewed here.`);
      render();
    } catch (err) {
      status.set('error', `Photo not saved. ${errorText(err, "Kenna couldn't save it. Your other photos are safe; try again.")}`);
    } finally {
      busy(false);
    }
  });

  return h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card-title', text: 'Progress Photos' }),
    h('p', {
      class: 'card-sub',
      text: `Photos are kept ${where} and are included in your backup file. Pick the day a photo was taken before adding it; you can change it later by opening the photo.`,
    }),
    h('div', { class: 'field' }, h('label', { for: dayInput.id, text: 'Day this photo was taken' }), dayInput),
    fileInput,
    uploadLabel,
    status.el
  );
}

/**
 * Loads each preview as it comes near the screen, so a long library never
 * loads every image at once.
 * @param {import('./render.js').ScreenContext} ctx
 * @returns {(button: HTMLElement, photo: Photo) => void}
 */
function lazyThumbs(ctx) {
  let released = false;
  ctx.onRelease(() => {
    released = true;
  });
  const cantPreview = () => h('span', { class: 'photo-missing', text: CANT_PREVIEW });
  /** @param {HTMLElement} button @param {Photo} p */
  async function load(button, p) {
    try {
      const src = await store.photoUrl(p, 'thumb');
      if (released) return src.release();
      ctx.onRelease(src.release);
      const img = h('img', { src: src.url, alt: '', decoding: 'async' });
      img.addEventListener('error', () => img.replaceWith(cantPreview()));
      button.append(img);
    } catch {
      if (!released) button.append(cantPreview());
    }
  }
  /** @type {Map<Element, Photo>} */
  const waiting = new Map();
  if (typeof IntersectionObserver !== 'function') return load;
  const observer = new IntersectionObserver(
    (items) => {
      for (const item of items) {
        const p = waiting.get(item.target);
        if (!item.isIntersecting || !p) continue;
        observer.unobserve(item.target);
        waiting.delete(item.target);
        load(/** @type {HTMLElement} */ (item.target), p);
      }
    },
    { rootMargin: '400px 0px' }
  );
  ctx.onRelease(() => observer.disconnect());
  return (button, p) => {
    waiting.set(button, p);
    observer.observe(button);
  };
}

/**
 * Picking two photos to see side by side. While picking, a tap on a photo
 * selects it instead of opening it.
 * @param {Photo[]} photos
 * @param {Record<string, import('../core.js').Entry>} entries
 * @param {HTMLElement} stack the screen, marked while picking
 */
function comparePicker(photos, entries, stack) {
  /** @type {Photo[]} */
  let picked = [];
  let active = false;
  const text = h('p', { class: 'notice-text' });
  const cancelBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel' });
  const bar = h('div', { class: 'card notice-card compare-bar', hidden: true, 'data-compare-bar': '' }, text, h('div', { class: 'notice-actions' }, cancelBtn));
  const startBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Compare photos' });

  function refresh() {
    bar.hidden = !active;
    stack.classList.toggle('is-picking', active);
    text.textContent = picked.length === 0 ? 'Tap two photos to see them side by side.' : 'Now tap a second photo.';
    stack.querySelectorAll('[data-photo]').forEach((el) => {
      const on = picked.some((p) => String(p.id) === /** @type {HTMLElement} */ (el).dataset.photo);
      if (active) el.setAttribute('aria-pressed', on ? 'true' : 'false');
      else el.removeAttribute('aria-pressed');
    });
  }
  // A photo moved to another day in the viewer is regrouped once picking ends.
  let stale = false;
  /** @param {Photo | null} first @param {boolean} [moved] a photo was moved to another day */
  function start(first, moved) {
    stale = stale || !!moved;
    active = true;
    picked = first ? [first] : [];
    refresh();
    bar.scrollIntoView({ block: 'nearest' });
    announce(first ? 'Photo picked. Now tap a second photo to compare.' : 'Tap two photos to compare.');
  }
  function stop() {
    active = false;
    picked = [];
    refresh();
    if (stale) render();
    else startBtn.focus();
  }
  /** @param {Photo} p */
  function toggle(p) {
    picked = picked.includes(p) ? picked.filter((x) => x !== p) : [...picked, p];
    refresh();
    if (picked.length === 2) openPhotoCompare(picked[0], picked[1], entries, stop);
  }
  startBtn.addEventListener('click', () => start(null));
  cancelBtn.addEventListener('click', stop);
  return { bar, startBtn: photos.length > 1 ? startBtn : null, isActive: () => active, start, toggle };
}

/** @type {import('./render.js').ScreenBuilder} */
export async function buildPhotos(ctx) {
  const now = today();
  const [photos, entries] = await Promise.all([store.listPhotos(), store.loadEntries()]);
  const addCard = buildAddCard();
  const stack = h('div', { class: 'screen-stack' }, addCard);
  if (photos.length === 0) {
    stack.append(h('section', { class: 'card' }, h('p', { class: 'empty-hint', text: 'No photos yet.' })));
    return { title: 'Photos', root: stack };
  }

  const picker = comparePicker(photos, entries, stack);
  if (picker.startBtn) addCard.append(picker.startBtn);
  stack.append(picker.bar);
  const showThumb = lazyThumbs(ctx);
  /** @type {Map<string, Photo[]>} */
  const byDay = new Map();
  for (const p of photos) byDay.set(p.date, [...(byDay.get(p.date) || []), p]);
  for (const date of [...byDay.keys()].sort().reverse()) {
    const grid = h('div', { class: 'photo-grid' });
    for (const p of byDay.get(date) || []) {
      const thumb = h('button', { type: 'button', class: 'photo-thumb', 'data-photo': String(p.id), 'aria-label': `Progress photo, ${core.formatDate(p.date, now)}` });
      thumb.addEventListener('click', () => {
        if (picker.isActive()) picker.toggle(p);
        else openPhotoViewer(photos, p, { onCompare: picker.start });
      });
      showThumb(thumb, p);
      grid.append(thumb);
    }
    stack.append(h('section', { class: 'card' }, h('h3', { class: 'section-title', text: core.formatRelativeDate(date, now) }), grid));
  }
  return { title: 'Photos', root: stack };
}
