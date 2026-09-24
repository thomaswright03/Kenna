// Two progress photos side by side, the older on the left, each labelled
// with its day (and the weight logged that day, if any).

import { core, h, uid, today } from './dom.js';
import { failureText } from './problems.js';
import { openDialog } from './feedback.js';
import { store } from './store.js';
import { inDateOrder } from './photo-viewer.js';
import { unviewablePhoto } from './photo-image.js';

/** @typedef {import('../store-local.js').Photo} Photo */

/**
 * @param {Photo} photo
 * @param {Record<string, import('../core.js').Entry>} entries
 * @param {(release: () => void) => void} keep called with a function that frees the image
 */
function comparedPhoto(photo, entries, keep) {
  const now = today();
  const entry = entries[photo.date];
  const date = core.formatDate(photo.date, now);
  const alt = `Progress photo, ${date}`;
  const img = h('img', { class: 'compare-img', alt });
  img.addEventListener('error', () => img.isConnected && img.replaceWith(unviewablePhoto(alt)));
  store
    .photoUrl(photo, 'full')
    .then((loaded) => {
      keep(loaded.release);
      img.src = loaded.url;
    })
    .catch((err) => img.replaceWith(h('p', { class: 'photo-missing', role: 'alert', text: failureText('Show a photo', err) })));
  return h(
    'figure',
    { class: 'compare-photo' },
    img,
    h(
      'figcaption',
      null,
      h('span', { class: 'compare-date', text: date }),
      entry && entry.weight !== null ? h('span', { class: 'compare-weight', text: core.formatWeight(entry.weight) }) : null
    )
  );
}

/**
 * @param {Photo} a
 * @param {Photo} b
 * @param {Record<string, import('../core.js').Entry>} entries for each day's weight
 * @param {() => void} [onClose]
 */
export function openPhotoCompare(a, b, entries, onClose) {
  const [older, newer] = inDateOrder([a, b]);
  const labelId = uid('compare');
  /** @type {(() => void)[]} */
  const releases = [];
  let closed = false;
  // An image that finishes loading after the dialog has closed is let go at once.
  const keep = (/** @type {() => void} */ release) => (closed ? release() : releases.push(release));
  const days = core.daysBetween(older.date, newer.date);
  const apart = days === 0 ? 'Both from the same day' : `${core.formatNumber(days)} day${days === 1 ? '' : 's'} apart`;
  const w1 = entries[older.date] ? entries[older.date].weight : null;
  const w2 = entries[newer.date] ? entries[newer.date].weight : null;
  const change = w1 !== null && w2 !== null && w1 !== w2 ? `, ${core.formatWeight(Math.abs(w2 - w1))} ${w2 < w1 ? 'down' : 'up'}` : '';
  const closeBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Close' });
  const content = h(
    'div',
    { class: 'viewer' },
    h('h2', { id: labelId, class: 'viewer-title', text: 'Compare photos' }),
    h('p', { class: 'viewer-position', text: `${apart}${change}` }),
    h('div', { class: 'compare-pair' }, comparedPhoto(older, entries, keep), comparedPhoto(newer, entries, keep)),
    closeBtn
  );
  const close = openDialog({
    labelId,
    content,
    className: 'dialog-viewer dialog-compare',
    initialFocus: closeBtn,
    onClose: () => {
      closed = true;
      releases.forEach((release) => release());
      if (onClose) onClose();
    },
  });
  closeBtn.addEventListener('click', () => close());
}
