// On iPhone and iPad, Safari may delete everything a website has stored
// once it hasn't been used for about a week, unless the site was added to
// the Home Screen. When Kenna runs in a Safari tab there (not from the Home
// Screen), Today says so and gives the steps. "Not now" hides the card for
// a week; it never appears once Kenna runs from the Home Screen, or in the
// server version, whose data isn't kept in the browser.

import { h, uid, prefs, BACKEND } from './dom.js';
import { announce } from './feedback.js';

const SNOOZE_KEY = 'installNoteSnoozedUntil';
export const INSTALL_NOTE_SNOOZE_DAYS = 7;

/** True when Kenna was opened from the Home Screen (or installed elsewhere). */
export function runningInstalled() {
  const nav = /** @type {Navigator & { standalone?: boolean }} */ (window.navigator);
  if (nav.standalone === true) return true;
  if (!window.matchMedia) return false;
  return ['standalone', 'fullscreen', 'minimal-ui'].some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches);
}

/** iPhone, iPod or iPad (which reports itself as a Mac with a touch screen). */
export function onAppleMobile() {
  const nav = window.navigator;
  if (/iPhone|iPad|iPod/.test(nav.userAgent)) return true;
  return /Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1;
}

/** Kenna's data is in this browser, on iPhone or iPad, in a tab. */
export function inAppleBrowserTab() {
  return BACKEND === 'local' && onAppleMobile() && !runningInstalled();
}

/** The steps, as an ordered list. */
export function installSteps() {
  return h(
    'ol',
    { class: 'install-steps' },
    h('li', { text: 'Tap the Share button (the square with an arrow) in Safari’s toolbar.' }),
    h('li', { text: 'Tap Add to Home Screen, then Add.' }),
    h('li', { text: 'From now on, open Kenna from its new icon.' })
  );
}

/**
 * The card for Today, or null when it doesn't apply or was hidden.
 * @param {boolean} hasData something is logged here already
 * @returns {{ root: HTMLElement, mounted: () => void } | null}
 */
export function buildInstallNote(hasData) {
  if (!inAppleBrowserTab()) return null;
  const snoozedUntil = prefs.get(SNOOZE_KEY, null);
  if (snoozedUntil && Date.parse(snoozedUntil) > Date.now()) return null;

  const titleId = uid('install-note');
  const headline = 'Add Kenna to your Home Screen';
  const why =
    'You’re using Kenna in a Safari tab. iPhone may delete your days and photos from a tab that hasn’t been used for about a week. On your Home Screen, they’re kept.';
  const laterBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Not now' });
  const root = h(
    'section',
    { class: 'card notice-card', 'aria-labelledby': titleId, 'data-install-note': '' },
    h('p', { class: 'notice-title', id: titleId, text: headline }),
    h('p', { class: 'notice-text', text: why }),
    installSteps(),
    hasData
      ? h('p', {
          class: 'notice-text',
          text: 'Kenna on the Home Screen may open empty, because iPhone keeps its data apart from Safari’s. Save a backup file here first, then import it there (Settings, Import Backup).',
        })
      : null,
    h('div', { class: 'notice-actions' }, laterBtn, hasData ? h('a', { class: 'btn btn-primary', href: '#/settings', text: 'Back up first' }) : null)
  );
  laterBtn.addEventListener('click', () => {
    prefs.set(SNOOZE_KEY, new Date(Date.now() + INSTALL_NOTE_SNOOZE_DAYS * 24 * 60 * 60 * 1000).toISOString());
    root.remove();
    announce(`Hidden for ${INSTALL_NOTE_SNOOZE_DAYS} days. Settings has the steps too.`);
  });
  return { root, mounted: () => announce(`${headline}. ${why}`) };
}
