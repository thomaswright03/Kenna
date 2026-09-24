// Messages to the user: banners, toasts, modal dialogs and the status line
// under each input.

import { h, uid, byId } from './dom.js';

/**
 * @typedef {{ tone?: 'info' | 'warning' | 'error', message: string }} Notice
 * @typedef {{ tone?: 'error', action?: { label: string, onClick: () => void }, onGone?: () => void }} ToastOptions
 *   onGone: runs when a message with a button goes without the button being used
 */

/**
 * Reads a message out to screen-reader users without showing anything.
 * @param {string} message
 */
export function announce(message) {
  const region = byId('announcer');
  region.textContent = '';
  // A fresh change after a tick is what makes screen readers speak it.
  setTimeout(() => {
    region.textContent = message;
  }, 50);
}

/** @param {Notice} notice */
export function showBanner(notice) {
  const banner = h(
    'div',
    { class: `banner banner-${notice.tone || 'info'}`, role: notice.tone === 'error' ? 'alert' : 'status' },
    h('p', { text: notice.message }),
    h('button', { type: 'button', class: 'btn-text', text: 'Dismiss', onClick: () => banner.remove() })
  );
  byId('banners').append(banner);
}

/** Each toast on screen, and how to dismiss it. @type {Map<HTMLElement, () => void>} */
const liveToasts = new Map();

// A message with a button stays until it's used, so the page gets room
// below its end to scroll clear of it: nothing is ever stuck under it.
function makeRoomForToasts() {
  const toasts = byId('toasts');
  const room = toasts.querySelector('.toast-actionable') ? toasts.getBoundingClientRect().height + 16 : 0;
  document.documentElement.style.setProperty('--toast-room', `${Math.ceil(room)}px`);
}

/**
 * A short message at the bottom of the screen. At most one message without
 * a button shows at a time (a new one replaces it); it goes after a few
 * seconds, or at a tap on it. A message with a button (Undo, Fix it) is
 * never taken away by time: it stays until the button is used, it's
 * dismissed (×), or the user moves on to another screen. Moving to another
 * screen clears messages about the one left, except one that says
 * `keepOnNavigate` it's about the screen being opened (Save and close's
 * "Saved for Today", or what was saved on the way out); that one goes when
 * the user moves on from there.
 * @param {string} message
 * @param {ToastOptions & { keepOnNavigate?: boolean }} [options]
 * @returns {() => void} dismisses the toast
 */
export function toast(message, options) {
  const opts = options || {};
  const toasts = byId('toasts');
  if (!opts.action) {
    for (const [el, dismissOther] of liveToasts) if (!el.classList.contains('toast-actionable')) dismissOther();
  }
  const classes = ['toast', opts.tone === 'error' ? 'toast-error' : '', opts.action ? 'toast-actionable' : ''].filter(Boolean).join(' ');
  const el = h('div', { class: classes, role: opts.tone === 'error' ? 'alert' : 'status', 'data-keep': opts.keepOnNavigate ? 'true' : null });
  el.append(h('span', { class: 'toast-text', text: message }));
  let gone = false;
  /** @param {boolean} [used] its button was used */
  const dismiss = (used) => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    liveToasts.delete(el);
    el.remove();
    makeRoomForToasts();
    if (!used && opts.onGone) opts.onGone();
  };
  const action = opts.action;
  if (action) {
    el.append(
      h('button', {
        type: 'button',
        class: 'toast-action',
        text: action.label,
        onClick: () => {
          dismiss(true);
          action.onClick();
        },
      }),
      h('button', { type: 'button', class: 'toast-close', 'aria-label': 'Dismiss', text: '×', onClick: () => dismiss() })
    );
  }
  toasts.append(el);
  liveToasts.set(el, dismiss);
  while (toasts.children.length > 3 && toasts.firstElementChild instanceof HTMLElement) {
    const oldest = toasts.firstElementChild;
    const dismissOldest = liveToasts.get(oldest);
    if (dismissOldest) dismissOldest();
    else oldest.remove();
  }
  const timer = action ? undefined : setTimeout(() => dismiss(), 4000);
  makeRoomForToasts();
  return () => dismiss();
}

/**
 * Called when another screen opens: clears messages about the one left.
 * Messages made while it opens (what was saved on the way out) come after
 * this, so they show on the new screen.
 */
export function clearToastsOnNavigation() {
  for (const [el, dismiss] of liveToasts) {
    if (el.dataset.keep === 'true') delete el.dataset.keep;
    else dismiss();
  }
}

// A message without a button never blocks a tap on what's under it (it
// lets taps through), but a tap on it still dismisses it.
document.addEventListener(
  'pointerdown',
  (event) => {
    for (const [el, dismiss] of liveToasts) {
      if (el.classList.contains('toast-actionable')) continue;
      const r = el.getBoundingClientRect();
      if (event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom) dismiss();
    }
  },
  true
);

/** @type {Set<(value?: unknown) => void>} */
const openDialogs = new Set();

/**
 * A native modal <dialog>: traps focus, closes on Escape, on a tap on the
 * backdrop and via its buttons, and gives focus back to what opened it.
 * `onDismiss` runs first on Escape or a backdrop tap; when it returns true
 * it has dealt with it (stepped back from a question asked inside the
 * dialog) and the dialog stays open.
 * @param {{ labelId: string, content: HTMLElement, className?: string, initialFocus?: HTMLElement, onClose?: (value: unknown) => void, onDismiss?: () => boolean }} options
 * @returns {(value?: unknown) => void} closes the dialog
 */
export function openDialog(options) {
  const returnFocus = document.activeElement;
  const dialog = h('dialog', { class: `dialog ${options.className || ''}`, 'aria-labelledby': options.labelId });
  dialog.append(options.content);
  document.body.append(dialog);
  let closed = false;
  /** @param {unknown} [value] */
  const close = (value) => {
    if (closed) return;
    closed = true;
    openDialogs.delete(close);
    if (dialog.open) dialog.close();
    dialog.remove();
    if (options.onClose) options.onClose(value);
    if (returnFocus instanceof HTMLElement && document.contains(returnFocus)) returnFocus.focus();
  };
  const dismiss = () => {
    if (!(options.onDismiss && options.onDismiss())) close(undefined);
  };
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    dismiss();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dismiss();
  });
  openDialogs.add(close);
  dialog.showModal();
  const first = options.initialFocus ? options.initialFocus : dialog.querySelector('button');
  if (first) first.focus();
  return close;
}

export function closeAllDialogs() {
  for (const close of Array.from(openDialogs)) close(undefined);
}

/**
 * @param {{ title: string, message?: string, details?: { intro: string, items: string[] } | null, confirmLabel: string, cancelLabel?: string, danger?: boolean }} options
 *   details: a short list under the message (what a restore will leave out)
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, message, details, confirmLabel, cancelLabel, danger }) {
  return new Promise((resolve) => {
    const labelId = uid('dlg');
    const cancelBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: cancelLabel || 'Cancel' });
    const okBtn = h('button', { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, text: confirmLabel });
    const content = h(
      'div',
      { class: 'dialog-body' },
      h('h2', { id: labelId, class: 'dialog-title', text: title }),
      message ? h('p', { class: 'dialog-text', text: message }) : null,
      details ? [h('p', { class: 'dialog-text', text: details.intro }), itemList(details.items)] : null,
      h('div', { class: 'dialog-actions' }, cancelBtn, okBtn)
    );
    const close = openDialog({ labelId, content, initialFocus: cancelBtn, onClose: (v) => resolve(v === true) });
    cancelBtn.addEventListener('click', () => close(false));
    okBtn.addEventListener('click', () => close(true));
  });
}

const LIST_SHOWN = 5;

/**
 * A short bulleted list; past a handful of items the rest are counted.
 * @param {string[]} items
 */
export function itemList(items) {
  const shown = items.slice(0, LIST_SHOWN).map((text) => h('li', { text }));
  const more = items.length - LIST_SHOWN;
  if (more > 0) shown.push(h('li', { text: `and ${more} more` }));
  return h('ul', { class: 'item-list' }, shown);
}

/**
 * @typedef {'pending' | 'saved' | 'error' | null} StatusState
 * @typedef {{ label: string, onClick: () => void }} StatusAction a button after the text (Retry, Undo)
 * @typedef {{ el: HTMLElement, set: (state: StatusState, text?: string, action?: StatusAction) => void }} StatusLine
 */

/**
 * A status line ("Saving…", "Saved", or an error), optionally with a
 * button after it. Under an input (`input` given) it describes that input,
 * marks it invalid on an error, reads changes out politely and clears a
 * plain "Saved" after a few seconds. Elsewhere it is a status region that
 * becomes an alert for an error.
 * @param {HTMLInputElement} [input]
 * @returns {StatusLine}
 */
export function createStatusLine(input) {
  const el = h('p', { class: 'field-status', id: uid('status') });
  if (input) {
    el.setAttribute('aria-live', 'polite');
    input.setAttribute('aria-describedby', el.id);
  } else {
    el.setAttribute('role', 'status');
  }
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {StatusLine['set']} */
  function set(state, text, action) {
    clearTimeout(timer);
    el.className = `field-status${state ? ` is-${state}` : ''}`;
    el.replaceChildren();
    if (input) {
      if (state === 'error') input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    } else {
      el.setAttribute('role', state === 'error' ? 'alert' : 'status');
    }
    if (!text) return;
    // A save can finish after the user has left the screen; say so there.
    if (input && !el.isConnected && state === 'error') {
      toast(text, { tone: 'error' });
      return;
    }
    el.append(h('span', { text }));
    if (action) el.append(h('button', { type: 'button', class: 'btn-text', text: action.label, onClick: action.onClick }));
    if (input && state === 'saved' && !action) timer = setTimeout(() => set(null), 4000);
  }
  return { el, set };
}

/**
 * The status line under an input.
 * @param {HTMLInputElement} input
 */
export const createFieldStatus = (input) => createStatusLine(input);
