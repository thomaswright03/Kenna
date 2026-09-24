// Progress photos, grouped by the day they're filed under. A photo opens in
// the viewer (photo-viewer.js); Compare photos puts two side by side
// (photo-compare.js).

import { core, h, uid, today } from './dom.js';
import { failureText } from './problems.js';
import { toast, createStatusLine, createFieldStatus, announce } from './feedback.js';
import { store } from './store.js';
import { render } from './render.js';
import { preparePhoto, makeThumbnail, CANT_PREVIEW } from './photo-image.js';
import { openPhotoViewer, photoDayProblem } from './photo-viewer.js';
import { openPhotoCompare } from './photo-compare.js';

/** @typedef {import('../store-local.js').Photo} Photo */

// The longest side of the copy Kenna keeps of a photo, in pixels.
const KEPT_SIZE = 1600;

/**
 * The step after a photo is picked: a preview and "Which day was this
 * photo taken?" (today unless changed, never a day to come), with Save
 * photo and Cancel.
 * @param {{ blob: Blob, viewable: boolean }} prepared
 * @param {{ save: (day: string) => Promise<boolean>, cancel: () => void }} on save resolves false when it failed
 */
function photoDayPanel(prepared, on) {
  const now = today();
  const dayInput = h('input', { type: 'date', id: uid('photo-day'), value: now, max: now, required: true });
  const dayStatus = createFieldStatus(dayInput);
  const url = prepared.viewable ? URL.createObjectURL(prepared.blob) : null;
  const cantPreview = () => h('p', { class: 'photo-missing', text: CANT_PREVIEW });
  const preview = url ? h('img', { class: 'photo-confirm-img', src: url, alt: 'The photo to add' }) : cantPreview();
  if (url) preview.addEventListener('error', () => preview.replaceWith(cantPreview()));
  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary', text: 'Save photo' });
  const cancelBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel' });
  const titleId = uid('photo-confirm');
  const root = h(
    'div',
    { class: 'photo-confirm', role: 'group', 'aria-labelledby': titleId },
    h('p', { class: 'section-title', id: titleId, text: 'Which day was this photo taken?' }),
    h('div', { class: 'photo-confirm-body' }, preview, h('div', { class: 'field' }, h('label', { for: dayInput.id, text: 'Day this photo was taken' }), dayInput, dayStatus.el)),
    h('div', { class: 'notice-actions' }, cancelBtn, saveBtn)
  );
  /** @param {boolean} on */
  const disable = (on) => {
    saveBtn.disabled = on;
    cancelBtn.disabled = on;
    dayInput.disabled = on;
  };

  dayInput.addEventListener('change', () => {
    const problem = photoDayProblem(dayInput.value);
    if (!problem) return;
    dayInput.value = today();
    dayStatus.set('error', problem);
  });
  cancelBtn.addEventListener('click', on.cancel);
  saveBtn.addEventListener('click', async () => {
    const day = dayInput.value || today();
    const problem = photoDayProblem(day);
    if (problem) return dayStatus.set('error', problem);
    disable(true);
    if (!(await on.save(day))) disable(false);
  });
  return {
    root,
    focus: () => saveBtn.focus({ preventScroll: true }),
    release: () => url && URL.revokeObjectURL(url),
  };
}

/** The Photos screen's title, and what happens to a photo added. */
function photosIntro() {
  return [
    h('h2', { class: 'card-title', text: 'Progress Photos' }),
    h('p', {
      class: 'card-sub',
      text: `Photos stay on this device and go in your backup file. Kenna keeps a smaller copy of each (${core.formatNumber(KEPT_SIZE)} pixels on its longest side), so keep the original in your photo library.`,
    }),
  ];
}

/**
 * The card with Add Photo, and a way to open the photo picker from
 * elsewhere on the screen. The photo is picked first, then its day is
 * confirmed (photoDayPanel), and only then is it saved.
 * @param {() => void} onAdded
 * @returns {{ card: HTMLElement, pick: () => void }}
 */
function buildAddCard(onAdded) {
  const status = createStatusLine();
  const fileInput = h('input', { type: 'file', accept: 'image/*,.heic,.heif', class: 'visually-hidden', id: uid('upload') });
  const uploadLabel = h('label', { class: 'btn btn-primary file-btn', for: fileInput.id, text: 'Add Photo' });
  const confirmSlot = h('div', { 'data-photo-confirm': '' });

  // While a photo is being read or saved, Add Photo can't start another.
  /** @param {string | null} doing what's under way ("Adding photo…"), or null */
  function busy(doing) {
    fileInput.disabled = !!doing;
    uploadLabel.classList.toggle('is-disabled', !!doing);
    uploadLabel.setAttribute('aria-disabled', doing ? 'true' : 'false');
    uploadLabel.textContent = doing || 'Add Photo';
  }
  // While a photo's day is being asked, Add Photo steps aside.
  /** @param {boolean} on */
  function asking(on) {
    uploadLabel.hidden = on;
    fileInput.hidden = on;
  }

  /** @type {ReturnType<typeof photoDayPanel> | null} */
  let panel = null;
  function closePanel() {
    if (!panel) return;
    panel.release();
    panel.root.remove();
    panel = null;
    asking(false);
  }

  /** @param {{ blob: Blob, viewable: boolean }} prepared @param {string} day */
  async function save(prepared, day) {
    busy('Adding photo…');
    status.set('pending', 'Saving photo…');
    try {
      const thumb = prepared.viewable ? await makeThumbnail(prepared.blob).catch(() => null) : null;
      await store.addPhoto({ date: day, blob: prepared.blob, thumb, createdAt: new Date().toISOString() });
      const added = day === today() ? 'Photo added' : `Photo added to ${core.formatRelativeDate(day)}`;
      status.set(null);
      closePanel();
      toast(prepared.viewable ? added : `${added}. It's saved, but this browser can't show this kind of photo, so it can't be previewed here.`);
      onAdded();
      return true;
    } catch (err) {
      status.set('error', `Photo not saved. ${failureText('Add a photo', err, "Kenna couldn't save it. Your other photos are safe; try again.")}`);
      return false;
    } finally {
      busy(null);
    }
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    closePanel();
    status.set('pending', 'Reading photo…');
    busy('Reading photo…');
    try {
      const prepared = await preparePhoto(file, KEPT_SIZE);
      status.set(null);
      const next = photoDayPanel(prepared, {
        save: (day) => save(prepared, day),
        cancel: () => {
          closePanel();
          announce('Photo not added.');
          uploadLabel.focus();
        },
      });
      panel = next;
      asking(true);
      confirmSlot.replaceChildren(next.root);
      next.focus();
      next.root.scrollIntoView({ block: 'nearest' });
    } catch (err) {
      status.set('error', `Photo not saved. ${failureText('Add a photo', err, "Kenna couldn't read it. Your other photos are safe; try again.")}`);
    } finally {
      busy(null);
    }
  });

  const card = h('section', { class: 'card' }, photosIntro(), fileInput, uploadLabel, confirmSlot, status.el);
  return { card, pick: () => fileInput.disabled || fileInput.click() };
}

/**
 * What progress photos are for, and a first one to add, while there are none.
 * @param {() => void} pick opens the photo picker
 */
function emptyCard(pick) {
  const titleId = uid('photos-empty');
  return h(
    'section',
    { class: 'card', 'aria-labelledby': titleId, 'data-photos-empty': '' },
    h('h3', { class: 'section-title', id: titleId, text: 'No photos yet' }),
    h('p', {
      class: 'card-sub',
      text: 'Progress photos show changes the scale doesn’t. Add one every week or two, in the same spot and light each time. Compare photos then puts two side by side, with your weight on each day.',
    }),
    h('button', { type: 'button', class: 'btn btn-secondary', text: 'Add your first photo', onClick: pick })
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
  const add = buildAddCard(() => render());
  const addCard = add.card;
  const stack = h('div', { class: 'screen-stack' }, addCard);
  if (photos.length === 0) {
    stack.append(emptyCard(add.pick));
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
