// Progress photos, grouped by the day they're filed under.

import { core, h, uid, BACKEND, today, errorText } from './dom.js';
import { toast, openDialog, confirmDialog } from './feedback.js';
import { store } from './store.js';
import { render } from './render.js';
import { preparePhoto, makeThumbnail } from './photo-image.js';

/** @typedef {import('../store-local.js').Photo} Photo */

/** @type {import('./render.js').ScreenBuilder} */
export async function buildPhotos(ctx) {
  const now = today();
  const photos = await store.listPhotos();
  const where = BACKEND === 'server' ? 'on the Kenna server' : 'on this device';

  const status = h('p', { class: 'field-status', role: 'status' });
  const dayInput = h('input', { type: 'date', id: uid('photo-day'), value: now, max: now, required: true });
  const fileInput = h('input', { type: 'file', accept: 'image/*,.heic,.heif', class: 'visually-hidden', id: uid('upload') });
  const uploadLabel = h('label', { class: 'btn btn-primary file-btn', for: fileInput.id, text: 'Add Photo' });

  /** @param {string} tone @param {string} text */
  function setStatus(tone, text) {
    status.className = `field-status${tone ? ` is-${tone}` : ''}`;
    status.textContent = text;
  }

  dayInput.addEventListener('change', () => {
    const problem = photoDayProblem(dayInput.value);
    if (problem) {
      dayInput.value = now;
      setStatus('error', problem);
    }
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const day = dayInput.value || now;
    const problem = photoDayProblem(day);
    if (problem) {
      setStatus('error', problem);
      return;
    }
    setStatus('pending', 'Saving photo…');
    busy(true);
    try {
      const blob = await preparePhoto(file, 1600);
      const thumb = await makeThumbnail(blob).catch(() => null);
      await store.addPhoto({ date: day, blob, thumb, createdAt: new Date().toISOString() });
      toast(day === today() ? 'Photo added' : `Photo added to ${core.formatRelativeDate(day)}`);
      render();
    } catch (err) {
      setStatus('error', `Photo not saved. ${errorText(err, "Kenna couldn't save it. Your other photos are safe; try again.")}`);
    } finally {
      busy(false);
    }
  });

  // While a photo is being saved, Add Photo can't start another.
  /** @param {boolean} on */
  function busy(on) {
    fileInput.disabled = on;
    dayInput.disabled = on;
    uploadLabel.classList.toggle('is-disabled', on);
    uploadLabel.setAttribute('aria-disabled', on ? 'true' : 'false');
    uploadLabel.textContent = on ? 'Adding photo…' : 'Add Photo';
  }

  const intro = h(
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
    status
  );

  const stack = h('div', { class: 'screen-stack' }, intro);
  if (photos.length === 0) {
    stack.append(h('section', { class: 'card' }, h('p', { class: 'empty-hint', text: 'No photos yet.' })));
    return { title: 'Photos', root: stack };
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

  // Previews are loaded as they come near the screen, so a long library
  // never loads every image at once.
  let released = false;
  ctx.onRelease(() => {
    released = true;
  });
  /** @param {HTMLElement} button @param {Photo} p */
  async function loadThumb(button, p) {
    if (button.dataset.loaded) return;
    button.dataset.loaded = 'true';
    const missing = () => button.append(h('span', { class: 'photo-missing', text: "Can't preview in this browser" }));
    try {
      const src = await store.photoUrl(p, 'thumb');
      if (released) {
        src.release();
        return;
      }
      ctx.onRelease(src.release);
      const img = h('img', { src: src.url, alt: '', decoding: 'async' });
      img.addEventListener('error', () => img.replaceWith(h('span', { class: 'photo-missing', text: "Can't preview in this browser" })));
      button.append(img);
    } catch {
      if (!released) missing();
    }
  }
  const observer =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(
          (items) => {
            for (const item of items) {
              if (!item.isIntersecting) continue;
              observer?.unobserve(item.target);
              const p = photos.find((x) => String(x.id) === /** @type {HTMLElement} */ (item.target).dataset.photo);
              if (p) loadThumb(/** @type {HTMLElement} */ (item.target), p);
            }
          },
          { rootMargin: '400px 0px' }
        )
      : null;
  if (observer) ctx.onRelease(() => observer.disconnect());

  for (const group of groups) {
    const dateLabel = core.formatRelativeDate(group.date, now);
    const grid = h('div', { class: 'photo-grid' });
    for (const p of group.items) {
      const thumb = h('button', {
        type: 'button',
        class: 'photo-thumb',
        'data-photo': String(p.id),
        'aria-label': `Progress photo, ${core.formatDate(p.date, now)}`,
      });
      thumb.addEventListener('click', () => openPhotoViewer(p));
      if (observer) observer.observe(thumb);
      else loadThumb(thumb, p);
      grid.append(thumb);
    }
    stack.append(h('section', { class: 'card' }, h('h3', { class: 'section-title', text: dateLabel }), grid));
  }
  return { title: 'Photos', root: stack };
}

/**
 * Why a photo can't be filed under `day`, or null if it can.
 * @param {string} day
 */
function photoDayProblem(day) {
  if (!core.isValidDateStr(day)) return 'Pick the day this photo was taken.';
  if (core.isFutureDate(day, today())) return "A photo can't be filed under a day that hasn't happened yet.";
  return null;
}

/** @param {Photo} photo */
function openPhotoViewer(photo) {
  const now = today();
  let dateText = core.formatDate(photo.date, now);
  let moved = false;
  const labelId = uid('photo');
  /** @type {{ url: string, release: () => void } | null} */
  let src = null;
  let closed = false;
  const title = h('h2', { id: labelId, class: 'viewer-title', text: `Progress photo, ${dateText}` });
  const img = h('img', { alt: `Progress photo, ${dateText}`, class: 'viewer-img' });
  store
    .photoUrl(photo, 'full')
    .then((loaded) => {
      if (closed) {
        loaded.release();
        return;
      }
      src = loaded;
      img.src = loaded.url;
    })
    .catch((err) => img.replaceWith(h('p', { class: 'photo-missing', role: 'alert', text: errorText(err) })));
  const dayInput = h('input', { type: 'date', id: uid('viewer-day'), value: photo.date, max: now, required: true });
  const dayStatus = h('p', { class: 'field-status', role: 'status' });
  const closeBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Close' });
  const deleteBtn = h('button', { type: 'button', class: 'btn btn-danger-outline', text: 'Delete…' });
  const content = h(
    'div',
    { class: 'viewer' },
    title,
    img,
    h('div', { class: 'field' }, h('label', { for: dayInput.id, text: 'Day this photo was taken' }), dayInput, dayStatus),
    h('div', { class: 'viewer-bar' }, deleteBtn, closeBtn)
  );
  const close = openDialog({
    labelId,
    content,
    className: 'dialog-viewer',
    initialFocus: closeBtn,
    onClose: () => {
      closed = true;
      if (src) src.release();
      if (moved) render();
    },
  });
  closeBtn.addEventListener('click', () => close());

  dayInput.addEventListener('change', async () => {
    const day = dayInput.value;
    const problem = photoDayProblem(day);
    if (problem) {
      dayInput.value = photo.date;
      dayStatus.className = 'field-status is-error';
      dayStatus.textContent = problem;
      return;
    }
    if (day === photo.date) return;
    dayStatus.className = 'field-status is-pending';
    dayStatus.textContent = 'Saving…';
    try {
      const updated = await store.updatePhoto(photo.id, { date: day });
      photo.date = updated.date;
      moved = true;
      dateText = core.formatDate(photo.date, now);
      title.textContent = `Progress photo, ${dateText}`;
      img.alt = `Progress photo, ${dateText}`;
      dayStatus.className = 'field-status is-saved';
      dayStatus.textContent = `Moved to ${core.formatRelativeDate(photo.date, now)}`;
    } catch (err) {
      dayInput.value = photo.date;
      dayStatus.className = 'field-status is-error';
      dayStatus.textContent = `Not moved. ${errorText(err)}`;
    }
  });

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
      moved = false;
      close();
      toast('Photo deleted');
      render();
    } catch (err) {
      toast(`Photo not deleted. ${errorText(err)}`, { tone: 'error' });
    }
  });
}
