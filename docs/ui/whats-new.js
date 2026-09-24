// "What's new in Kenna": a guided tour of what the update added. It moves
// through the app's own screens, lights up each new feature where it
// lives, and explains it in a card beside it. It opens by itself once, on
// the first launch after the update, for someone who had already logged
// days; anyone can take it again from Settings.

import { h, uid, prefs, byId, visibleEntries } from './dom.js';
import { store } from './store.js';
import { route, navigate } from './router.js';
import { recordProblem } from './problems.js';

// Change this when the tour describes a newer update, so it opens once
// more for everyone who saw the last one.
export const WHATS_NEW_VERSION = '2026-09';
const SEEN_KEY = 'whatsNewSeen';

/**
 * @typedef {object} Stop
 * @property {string} where the screen the stop is on, shown above its title
 * @property {string} title
 * @property {string[]} points
 * @property {string} [hash] the screen's address; none keeps the one shown
 * @property {import('./router.js').ScreenName} [screen] the screen `hash` opens
 * @property {() => Element | null} [find] what to light up; none centers the card
 */

/** @param {string} selector */
const inMain = (selector) => () => byId('main').querySelector(selector);

/** @param {string} text a button's exact words */
const buttonNamed = (text) => () => Array.from(byId('main').querySelectorAll('button')).find((b) => b.textContent === text) || null;

/** @type {Stop[]} */
export const STOPS = [
  {
    where: 'Welcome',
    title: 'What’s new in Kenna',
    points: ['Kenna has had a big update. This quick tour shows you each new feature right where it is.', 'Tap Next to start, or Close to skip. You can take the tour again from Settings.'],
  },
  {
    where: 'Today',
    hash: '#/',
    screen: 'today',
    find: inMain('.day-switch'),
    title: 'View or fix any past day',
    points: ['Tap Change day and pick a date to see or fix it. Back to today brings you home.', 'Tapping a day in History opens it too.'],
  },
  {
    where: 'Today',
    hash: '#/',
    screen: 'today',
    find: inMain('.meal-list'),
    title: 'Tap a meal to log it',
    points: ['Tap any meal’s row to jump straight to it in Log Meal.', 'Removed a meal by mistake? Its row offers Undo.'],
  },
  {
    where: 'Log Meal',
    hash: '#/log',
    screen: 'log',
    find: inMain('.meal-picker'),
    title: 'One number per meal, saved as you go',
    points: ['Each number saves when you leave its box, even if you switch apps. Enter moves on to the next meal.', 'Save and close takes you back and tells you the day’s total, with Undo.'],
  },
  {
    where: 'Today',
    hash: '#/',
    screen: 'today',
    find: () => {
      const input = byId('main').querySelector('input[inputmode="decimal"]');
      return input ? input.closest('.field') : null;
    },
    title: 'Your weight saves itself',
    points: ['It saves when you leave the box or press Enter.', 'Emptying the box clears the day’s weight, with Undo to put it back.'],
  },
  {
    where: 'Today',
    hash: '#/',
    screen: 'today',
    find: inMain('[aria-label="Chart range"]'),
    title: 'Clearer graphs',
    points: ['Switch between the last 30 days, 90 days or all time.', 'A day you didn’t log is a gap, never a zero, and today’s calories so far are a hollow marker.'],
  },
  {
    where: 'Today',
    hash: '#/',
    screen: 'today',
    find: inMain('[data-backup-status], [data-backup-reminder]'),
    title: 'Know when you last backed up',
    points: ['Today always shows how old your last backup is, with Back up now.', 'After a week without one, Kenna reminds you.'],
  },
  {
    where: 'History',
    hash: '#/history',
    screen: 'history',
    find: inMain('.history-month'),
    title: 'History by month',
    points: ['Days are grouped by month, each with its average calories and weight.', 'Tap a day to open it; Back returns you to this same spot.'],
  },
  {
    where: 'Compare',
    hash: '#/compare',
    screen: 'compare',
    find: inMain('.compare-answer'),
    title: 'How am I doing today?',
    points: ['Compare answers in plain words: today’s calories against your usual for the same meals, and your weight against your average and yesterday.', 'See each meal, further down, breaks it down meal by meal.'],
  },
  {
    where: 'Photos',
    hash: '#/photos',
    screen: 'photos',
    find: inMain('.file-btn'),
    title: 'Progress photos, filed by day',
    points: ['Add Photo picks the picture first, then asks which day it was taken.', 'Compare photos puts two side by side with each day’s weight.'],
  },
  {
    where: 'Settings',
    hash: '#/settings',
    screen: 'settings',
    find: buttonNamed('Export Backup'),
    title: 'Back up everything in one file',
    points: ['Export Backup saves every day and photo in one file. Keep it in Files or iCloud Drive.', 'Import Backup restores it, and can be undone.'],
  },
];

/** How long to wait for a screen to open before lighting up its heading instead. */
const ARRIVE_TIMEOUT_MS = 4000;
/** Space kept between the lit-up feature, the card and the screen's edges. */
const GAP = 12;
const EDGE = 12;

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

/** The address shown, with the bare one written as Today's. */
const currentHash = () => (window.location.hash && window.location.hash !== '#' ? window.location.hash : '#/');

/**
 * The tour's card, and the dimmed layer with the light it sits in.
 * @param {string} labelId
 */
function buildTour(labelId) {
  const els = {
    where: h('p', { class: 'tour-where' }),
    title: h('h2', { id: labelId, class: 'tour-title', tabindex: '-1' }),
    points: h('ul', { class: 'tour-points' }),
    position: h('p', { class: 'tour-position' }),
    dots: h(
      'div',
      { class: 'tour-dots', 'aria-hidden': 'true' },
      STOPS.map(() => h('span', { class: 'tour-dot' }))
    ),
    backBtn: h('button', { type: 'button', class: 'btn btn-secondary', text: 'Back' }),
    nextBtn: h('button', { type: 'button', class: 'btn btn-primary', text: 'Next' }),
    closeBtn: h('button', { type: 'button', class: 'btn-text tour-close', text: 'Close' }),
    arrow: h('span', { class: 'tour-arrow', 'aria-hidden': 'true' }),
    spot: h('div', { class: 'tour-spot', 'aria-hidden': 'true' }),
  };
  const card = h(
    'div',
    { class: 'tour-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelId, 'data-whats-new': '' },
    els.arrow,
    h('div', { class: 'tour-head' }, els.where, els.closeBtn),
    els.title,
    els.points,
    h('div', { class: 'tour-foot' }, els.dots, els.position),
    h('div', { class: 'tour-actions' }, els.backBtn, els.nextBtn)
  );
  const layer = h('div', { class: 'tour-layer', 'data-tour': '' }, els.spot, card);
  return { ...els, card, layer };
}

/** @typedef {ReturnType<typeof buildTour>} Tour */

/**
 * Puts the light on `target` and the card beside it (below when there's
 * room, else above), or the card in the middle when there's no target.
 * @param {Tour} t
 * @param {Element | null} target
 */
function place(t, target) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardWidth = Math.min(360, vw - 2 * EDGE);
  t.card.style.width = `${cardWidth}px`;
  const cardHeight = t.card.offsetHeight;
  if (!target || !target.isConnected) {
    t.layer.classList.add('is-centered');
    t.spot.style.cssText = `top:${vh / 2}px;left:${vw / 2}px;width:0;height:0;`;
    t.card.style.left = `${(vw - cardWidth) / 2}px`;
    t.card.style.top = `${Math.max(EDGE, (vh - cardHeight) / 2)}px`;
    return;
  }
  t.layer.classList.remove('is-centered');
  const r = target.getBoundingClientRect();
  const pad = 6;
  // A feature taller than the room left over is lit only as far as fits.
  const top = Math.max(EDGE, r.top - pad);
  const bottom = Math.min(r.bottom + pad, Math.max(top + 48, vh - EDGE - cardHeight - GAP), vh - EDGE);
  const left = Math.max(EDGE / 2, r.left - pad);
  const right = Math.min(vw - EDGE / 2, r.right + pad);
  t.spot.style.cssText = `top:${top}px;left:${left}px;width:${right - left}px;height:${bottom - top}px;`;

  const below = vh - bottom - GAP - EDGE;
  const above = top - GAP - EDGE;
  const side = below >= cardHeight || below >= above ? 'below' : 'above';
  const cardTop = side === 'below' ? Math.min(bottom + GAP, vh - EDGE - cardHeight) : Math.max(EDGE, top - GAP - cardHeight);
  const centre = (left + right) / 2;
  const cardLeft = Math.min(Math.max(EDGE, centre - cardWidth / 2), vw - EDGE - cardWidth);
  t.card.style.left = `${cardLeft}px`;
  t.card.style.top = `${cardTop}px`;
  t.card.dataset.side = side;
  t.arrow.style.left = `${Math.min(Math.max(20, centre - cardLeft), cardWidth - 20)}px`;
}

/**
 * Opens the stop's screen and waits for its feature to be drawn. When
 * the feature can't be found, the screen's heading is lit instead.
 * @param {Stop} stop
 * @param {() => boolean} isCurrent false once the tour has moved on or closed
 * @returns {Promise<Element | null>}
 */
async function arrive(stop, isCurrent) {
  if (!stop.find) return null;
  if (stop.hash && currentHash() !== stop.hash) navigate(stop.hash);
  const deadline = performance.now() + ARRIVE_TIMEOUT_MS;
  const main = byId('main');
  for (;;) {
    await nextFrame();
    if (!isCurrent()) return null;
    const ready = route.screen === stop.screen && main.getAttribute('aria-busy') !== 'true';
    const found = ready ? stop.find() : null;
    if (found) return found;
    if (performance.now() > deadline) return ready ? main.querySelector('h2') : null;
  }
}

/**
 * Scrolls a feature to a third of the way down the screen, or a tall one
 * to near the top, leaving room for the card below it.
 * @param {Element} el
 */
function bringIntoView(el) {
  const r = el.getBoundingClientRect();
  const wanted = r.height > window.innerHeight * 0.45 ? EDGE * 2 : window.innerHeight / 3 - r.height / 2;
  window.scrollBy(0, r.top - wanted);
}

/**
 * Fills the card with a stop's words and where it is in the tour.
 * @param {Tour} t
 * @param {number} index
 */
function fill(t, index) {
  const stop = STOPS[index];
  t.where.textContent = stop.where;
  t.title.textContent = stop.title;
  t.points.replaceChildren(...stop.points.map((text) => h('li', { text })));
  t.position.textContent = `${index + 1} of ${STOPS.length}`;
  Array.from(t.dots.children).forEach((dot, i) => dot.classList.toggle('is-current', i === index));
  t.backBtn.disabled = index === 0;
  t.nextBtn.textContent = index === STOPS.length - 1 ? 'Done' : 'Next';
}

/** @type {(() => void) | null} */
let closeOpenTour = null;

/** Starts the tour at its first stop. */
export function showWhatsNew() {
  if (closeOpenTour) closeOpenTour();
  prefs.set(SEEN_KEY, WHATS_NEW_VERSION);
  const startHash = currentHash();
  const returnFocus = document.activeElement;
  const app = document.querySelector('.app');
  const t = buildTour(uid('tour'));
  let index = 0;
  let moveSeq = 0;
  /** @type {Element | null} */
  let target = null;

  // Only the tour can be used while it runs; the screens behind it are
  // there to be looked at.
  if (app instanceof HTMLElement) app.inert = true;
  document.body.append(t.layer);

  async function show() {
    const seq = (moveSeq += 1);
    t.layer.classList.add('is-moving');
    const found = await arrive(STOPS[index], () => seq === moveSeq);
    if (seq !== moveSeq) return;
    target = found;
    if (target) bringIntoView(target);
    fill(t, index);
    place(t, target);
    t.layer.classList.remove('is-moving');
    // The new stop's title is read out when focus lands on it.
    t.title.focus({ preventScroll: true });
  }

  const reposition = () => {
    if (!t.layer.classList.contains('is-moving')) place(t, target);
  };
  /** @param {KeyboardEvent} e */
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      // Focus stays in the card.
      e.preventDefault();
      const buttons = [t.closeBtn, t.backBtn, t.nextBtn].filter((b) => !b.disabled);
      const at = buttons.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
      buttons[(at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
    }
  };
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, { passive: true });
  document.addEventListener('keydown', onKey, true);

  function close() {
    if (closeOpenTour !== close) return;
    closeOpenTour = null;
    moveSeq += 1;
    window.removeEventListener('resize', reposition);
    window.removeEventListener('scroll', reposition);
    document.removeEventListener('keydown', onKey, true);
    t.layer.remove();
    if (app instanceof HTMLElement) app.inert = false;
    if (currentHash() !== startHash) navigate(startHash);
    else if (returnFocus instanceof HTMLElement && document.contains(returnFocus)) returnFocus.focus();
  }
  closeOpenTour = close;

  t.backBtn.addEventListener('click', () => {
    if (index === 0) return;
    index -= 1;
    show();
  });
  t.nextBtn.addEventListener('click', () => {
    if (index === STOPS.length - 1) return close();
    index += 1;
    return show();
  });
  t.closeBtn.addEventListener('click', close);
  show();
}

/**
 * On launch: starts the tour once for someone who used Kenna before this
 * update (they have logged days and haven't seen it). A brand-new user
 * starts with Today's welcome instead, and isn't shown "what's new" later
 * on either.
 */
export async function showWhatsNewOnce() {
  if (prefs.get(SEEN_KEY, null) === WHATS_NEW_VERSION) return;
  if (route.screen !== 'today' || document.querySelector('dialog[open]')) return;
  try {
    const entries = await store.loadEntries();
    if (visibleEntries(entries).length === 0) {
      prefs.set(SEEN_KEY, WHATS_NEW_VERSION);
      return;
    }
  } catch (err) {
    recordProblem('Open what’s new', err);
    return;
  }
  if (route.screen !== 'today' || document.querySelector('dialog[open]')) return;
  showWhatsNew();
}
