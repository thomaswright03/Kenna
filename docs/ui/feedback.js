// Messages to the user: banners, toasts, modal dialogs and the status line
// under each input.

import { h, uid, byId } from './dom.js';

/**
 * @typedef {{ tone?: 'info' | 'warning' | 'error', message: string }} Notice
 * @typedef {{ tone?: 'error', action?: { label: string, onClick: () => void }, duration?: number }} ToastOptions
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

/**
 * A short message at the bottom of the screen. At most one message without
 * a button shows at a time (a new one replaces it), a tap on it dismisses
 * it, and moving to another screen clears it unless `keepOnNavigate` says
 * it's about the screen being opened (Save and close's "Saved for Today").
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
  const dismiss = () => {
    clearTimeout(timer);
    liveToasts.delete(el);
    el.remove();
  };
  const action = opts.action;
  if (action) {
    el.append(
      h('button', {
        type: 'button',
        class: 'toast-action',
        text: action.label,
        onClick: () => {
          dismiss();
          action.onClick();
        },
      })
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
  const timer = setTimeout(dismiss, opts.duration || (opts.action ? 7000 : 4000));
  return dismiss;
}

/** Called when another screen opens: clears messages about the one left. */
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
 * @param {{ labelId: string, content: HTMLElement, className?: string, initialFocus?: HTMLElement, onClose?: (value: unknown) => void }} options
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
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close(undefined);
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close(undefined);
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
 * @param {{ title: string, message?: string, confirmLabel: string, danger?: boolean }} options
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, message, confirmLabel, danger }) {
  return new Promise((resolve) => {
    const labelId = uid('dlg');
    const cancelBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel' });
    const okBtn = h('button', { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, text: confirmLabel });
    const content = h(
      'div',
      { class: 'dialog-body' },
      h('h2', { id: labelId, class: 'dialog-title', text: title }),
      message ? h('p', { class: 'dialog-text', text: message }) : null,
      h('div', { class: 'dialog-actions' }, cancelBtn, okBtn)
    );
    const close = openDialog({ labelId, content, initialFocus: cancelBtn, onClose: (v) => resolve(v === true) });
    cancelBtn.addEventListener('click', () => close(false));
    okBtn.addEventListener('click', () => close(true));
  });
}

/**
 * @typedef {'pending' | 'saved' | 'error' | null} FieldState
 * @typedef {{ el: HTMLElement, set: (state: FieldState, text?: string, retry?: () => void) => void }} FieldStatus
 */

/**
 * The status line under an input ("Saving…", "Saved", or an error with a
 * Retry button), announced to screen readers.
 * @param {HTMLInputElement} input
 * @returns {FieldStatus}
 */
export function createFieldStatus(input) {
  const el = h('p', { class: 'field-status', id: uid('status'), 'aria-live': 'polite' });
  input.setAttribute('aria-describedby', el.id);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {FieldStatus['set']} */
  function set(state, text, retry) {
    clearTimeout(timer);
    el.className = `field-status${state ? ` is-${state}` : ''}`;
    el.replaceChildren();
    if (state === 'error') input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    if (!text) return;
    // A save can finish after the user has left the screen; say so there.
    if (!el.isConnected && state === 'error') {
      toast(text, { tone: 'error' });
      return;
    }
    el.append(h('span', { text }));
    if (retry) el.append(h('button', { type: 'button', class: 'btn-text', text: 'Retry', onClick: retry }));
    if (state === 'saved') timer = setTimeout(() => set(null), 4000);
  }
  return { el, set };
}
