// The photo viewer: one progress photo at a time, with Previous and Next
// (buttons, a swipe, or the arrow keys) through every photo in date order.
// From here a photo can be moved to another day, deleted, or picked for a
// side-by-side comparison.

import { core, h, uid, today, errorText } from './dom.js';
import { toast, openDialog, confirmDialog, createStatusLine } from './feedback.js';
import { store } from './store.js';
import { render } from './render.js';

/** @typedef {import('../store-local.js').Photo} Photo */

/**
 * Photos oldest first, by the day they're filed under, then the time they
 * were added.
 * @param {Photo[]} photos
 */
export function inDateOrder(photos) {
  return [...photos].sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? -1 : 1) : a.date < b.date ? -1 : 1));
}

/**
 * Why a photo can't be filed under `day`, or null if it can.
 * @param {string} day
 */
export function photoDayProblem(day) {
  if (!core.isValidDateStr(day)) return 'Pick the day this photo was taken.';
  if (core.isFutureDate(day, today())) return core.FUTURE_PHOTO;
  return null;
}

/**
 * Calls `onSwipe(-1)` for a swipe to the right (back to the previous
 * photo) and `onSwipe(1)` for a swipe to the left.
 * @param {HTMLElement} el
 * @param {(step: number) => void} onSwipe
 */
function onHorizontalSwipe(el, onSwipe) {
  /** @type {{ x: number, y: number } | null} */
  let from = null;
  el.addEventListener('pointerdown', (e) => {
    from = { x: e.clientX, y: e.clientY };
  });
  el.addEventListener('pointerup', (e) => {
    if (!from) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    from = null;
    if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx < 0 ? 1 : -1);
  });
  el.addEventListener('pointercancel', () => {
    from = null;
  });
}

/**
 * The image area: loads a photo's full image, releasing the previous one.
 * @returns {{ el: HTMLElement, show: (photo: Photo, alt: string) => void, release: () => void }}
 */
function photoFrame() {
  const el = h('div', { class: 'viewer-frame' });
  /** @type {{ url: string, release: () => void } | null} */
  let src = null;
  let shown = 0;
  const release = () => {
    if (src) src.release();
    src = null;
    shown += 1;
  };
  return {
    el,
    release,
    show(photo, alt) {
      release();
      const mine = shown;
      const img = h('img', { alt, class: 'viewer-img' });
      el.replaceChildren(img);
      store
        .photoUrl(photo, 'full')
        .then((loaded) => {
          if (mine !== shown) return loaded.release();
          src = loaded;
          img.src = loaded.url;
        })
        .catch((err) => mine === shown && img.replaceWith(h('p', { class: 'photo-missing', role: 'alert', text: errorText(err) })));
    },
  };
}

/**
 * Where the viewer is: every photo in date order, the one shown, and
 * whether one was moved to another day (the Photos screen then regroups).
 * @typedef {{ list: Photo[], index: number, moved: boolean }} ViewerState
 */

/** The viewer's controls. @param {boolean} several there's more than one photo */
function viewerControls(several) {
  const now = today();
  const c = {
    labelId: uid('photo'),
    title: h('h2', { class: 'viewer-title' }),
    position: h('p', { class: 'viewer-position', 'aria-live': 'polite' }),
    frame: photoFrame(),
    prevBtn: h('button', { type: 'button', class: 'btn btn-secondary', text: '‹ Previous', 'aria-label': 'Previous photo' }),
    nextBtn: h('button', { type: 'button', class: 'btn btn-secondary', text: 'Next ›', 'aria-label': 'Next photo' }),
    dayInput: h('input', { type: 'date', id: uid('viewer-day'), max: now, required: true }),
    dayStatus: createStatusLine(),
    closeBtn: h('button', { type: 'button', class: 'btn btn-secondary', text: 'Close' }),
    compareBtn: h('button', { type: 'button', class: 'btn btn-secondary', text: 'Compare…' }),
    deleteBtn: h('button', { type: 'button', class: 'btn btn-danger-outline', text: 'Delete…' }),
  };
  c.title.id = c.labelId;
  const content = h(
    'div',
    { class: 'viewer' },
    c.title,
    c.position,
    c.frame.el,
    several ? h('div', { class: 'viewer-nav' }, c.prevBtn, c.nextBtn) : null,
    h('div', { class: 'field' }, h('label', { for: c.dayInput.id, text: 'Day this photo was taken' }), c.dayInput, c.dayStatus.el),
    h('div', { class: 'viewer-bar' }, c.deleteBtn, several ? c.compareBtn : null, c.closeBtn)
  );
  return { ...c, content };
}

/** @typedef {ReturnType<typeof viewerControls>} ViewerControls */

/** @param {ViewerState} v @param {ViewerControls} c */
function showCurrent(v, c) {
  const photo = v.list[v.index];
  const text = `Progress photo, ${core.formatDate(photo.date, today())}`;
  c.title.textContent = text;
  c.position.textContent = v.list.length > 1 ? `${v.index + 1} of ${v.list.length}, oldest first` : '';
  // A button that can't go further is disabled; if it had focus, focus
  // moves to the other one rather than being lost.
  const focused = document.activeElement;
  c.prevBtn.disabled = v.index === 0;
  c.nextBtn.disabled = v.index === v.list.length - 1;
  if (focused === c.prevBtn && c.prevBtn.disabled) c.nextBtn.focus();
  if (focused === c.nextBtn && c.nextBtn.disabled) c.prevBtn.focus();
  c.dayInput.value = photo.date;
  c.dayStatus.set(null);
  c.frame.show(photo, text);
}

/**
 * Files the shown photo under the day picked in the viewer.
 * @param {ViewerState} v
 * @param {ViewerControls} c
 */
async function moveToPickedDay(v, c) {
  const photo = v.list[v.index];
  const day = c.dayInput.value;
  const problem = photoDayProblem(day);
  if (problem) {
    c.dayInput.value = photo.date;
    c.dayStatus.set('error', problem);
    return;
  }
  if (day === photo.date) return;
  c.dayStatus.set('pending', 'Saving…');
  try {
    photo.date = (await store.updatePhoto(photo.id, { date: day })).date;
    v.moved = true;
    v.list = inDateOrder(v.list);
    v.index = v.list.indexOf(photo);
    showCurrent(v, c);
    c.dayStatus.set('saved', `Moved to ${core.formatRelativeDate(photo.date, today())}`);
  } catch (err) {
    c.dayInput.value = photo.date;
    c.dayStatus.set('error', `Not moved. ${errorText(err)}`);
  }
}

/**
 * Deletes the shown photo, once confirmed.
 * @param {ViewerState} v
 * @param {() => void} close
 */
async function deleteShown(v, close) {
  const photo = v.list[v.index];
  const ok = await confirmDialog({
    title: `Delete this photo from ${core.formatDate(photo.date, today())}?`,
    message: "It will be removed from Kenna for good. This can't be undone.",
    confirmLabel: 'Delete photo',
    danger: true,
  });
  if (!ok) return;
  try {
    await store.deletePhoto(photo.id);
    v.moved = false;
    close();
    toast('Photo deleted');
    render();
  } catch (err) {
    toast(`Photo not deleted. ${errorText(err)}`, { tone: 'error' });
  }
}

/**
 * @param {Photo[]} photos every photo (any order)
 * @param {Photo} first the one to open
 * @param {{ onCompare: (photo: Photo, moved: boolean) => void }} options onCompare: pick this photo for a side-by-side
 *   comparison (moved: a photo was moved to another day while the viewer was open)
 */
export function openPhotoViewer(photos, first, options) {
  const list = inDateOrder(photos);
  /** @type {ViewerState} */
  const v = { list, index: Math.max(0, list.indexOf(first)), moved: false };
  const c = viewerControls(list.length > 1);
  /** @param {number} step */
  const go = (step) => {
    if (v.index + step < 0 || v.index + step >= v.list.length) return;
    v.index += step;
    showCurrent(v, c);
  };
  // The arrow keys step through the photos, except while typing a day or
  // while a question (Delete this photo?) is open over the viewer.
  /** @param {KeyboardEvent} e */
  const onKey = (e) => {
    if (e.target === c.dayInput || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    if (document.querySelectorAll('dialog[open]').length > 1) return;
    e.preventDefault();
    go(e.key === 'ArrowLeft' ? -1 : 1);
  };
  document.addEventListener('keydown', onKey);
  const close = openDialog({
    labelId: c.labelId,
    content: c.content,
    className: 'dialog-viewer',
    initialFocus: c.closeBtn,
    onClose: () => {
      document.removeEventListener('keydown', onKey);
      c.frame.release();
      if (v.moved) render();
    },
  });
  showCurrent(v, c);

  c.prevBtn.addEventListener('click', () => go(-1));
  c.nextBtn.addEventListener('click', () => go(1));
  onHorizontalSwipe(c.frame.el, go);
  c.closeBtn.addEventListener('click', () => close());
  c.compareBtn.addEventListener('click', () => {
    const picked = v.list[v.index];
    const moved = v.moved;
    v.moved = false;
    close();
    options.onCompare(picked, moved);
  });
  c.dayInput.addEventListener('change', () => moveToPickedDay(v, c));
  c.deleteBtn.addEventListener('click', () => deleteShown(v, close));
}
