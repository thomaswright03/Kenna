// "What's new in Kenna": a short walkthrough of what the update added, one
// card at a time in a dialog. It opens by itself once, on the first launch
// after the update, for someone who had already logged days; anyone can
// open it again from Settings.

import { h, uid, prefs, visibleEntries } from './dom.js';
import { openDialog } from './feedback.js';
import { store } from './store.js';
import { route } from './router.js';
import { recordProblem } from './problems.js';

// Change this when the cards describe a newer update, so the walkthrough
// opens once more for everyone who saw the last one.
export const WHATS_NEW_VERSION = '2026-09';
const SEEN_KEY = 'whatsNewSeen';

/**
 * @typedef {{ where: string, title: string, points: string[] }} Card
 * where: the screen the card is about, shown above its title
 */

/** @type {Card[]} */
export const CARDS = [
  {
    where: 'Welcome',
    title: 'What’s new in Kenna',
    points: [
      'Kenna has had a big update. These cards show what’s new, one screen at a time.',
      'Tap Next to go through them, or Close to skip. You can see them again any time from Settings.',
    ],
  },
  {
    where: 'Today',
    title: 'View or fix any past day',
    points: [
      'Tap Change day beside the day’s heading and pick a date, or tap a day in History.',
      'Back to today returns to the current day.',
      'Under the day, Kenna says how old your last backup is, with Back up now.',
    ],
  },
  {
    where: 'Log Meal',
    title: 'Logging is quicker, and nothing gets lost',
    points: [
      'Tap any meal’s row on Today to open Log Meal right at that meal.',
      'Each number saves when you leave its box, even if you switch apps. Enter moves on to the next meal.',
      'Save and close takes you back to the day and tells you its total.',
    ],
  },
  {
    where: 'Today',
    title: 'Undo a slip',
    points: [
      'After you leave Log Meal, the next screen says what was saved, with Undo.',
      'Removed a meal or cleared the weight by mistake? Tap Undo to put it back.',
      'Your weight saves when you leave its box or press Enter.',
    ],
  },
  {
    where: 'Today',
    title: 'Clearer graphs',
    points: [
      'Show the last 30 days, 90 days or all time.',
      'A day you didn’t log is a gap, never a zero, and today’s calories so far show as a hollow marker until the day is over.',
    ],
  },
  {
    where: 'History',
    title: 'History by month',
    points: [
      'Days are grouped by month, each with its average calories and weight.',
      'Show earlier months adds more, and Go to month jumps straight to one.',
      'Tap a day to open it; Back returns you to the same place in History.',
    ],
  },
  {
    where: 'Compare',
    title: 'A plain answer to “how am I doing today?”',
    points: [
      'Compare starts with two sentences: today’s calories against your usual for the same meals, and today’s weight against your average and yesterday.',
      'See each meal shows every meal’s numbers, and 7-day averages are further down.',
    ],
  },
  {
    where: 'Photos',
    title: 'Progress photos, filed by day',
    points: [
      'Add Photo picks the picture first, then asks which day it was taken.',
      'Swipe through photos in the viewer, and Compare photos puts two side by side with each day’s weight.',
    ],
  },
  {
    where: 'Settings',
    title: 'Back up everything in one file',
    points: [
      'Export Backup in Settings saves every day and photo in one file. Keep it in Files or iCloud Drive.',
      'Import Backup restores it, and can be undone. Today reminds you when your last backup is a week old.',
      'Settings also has a light or dark theme.',
    ],
  },
];

/** Opens the walkthrough at its first card. */
export function showWhatsNew() {
  prefs.set(SEEN_KEY, WHATS_NEW_VERSION);
  const labelId = uid('whats-new');
  let index = 0;

  const where = h('p', { class: 'tour-where' });
  const title = h('h2', { id: labelId, class: 'dialog-title', tabindex: '-1' });
  const points = h('ul', { class: 'tour-points' });
  const position = h('p', { class: 'tour-position' });
  const dots = h(
    'div',
    { class: 'tour-dots', 'aria-hidden': 'true' },
    CARDS.map(() => h('span', { class: 'tour-dot' }))
  );
  const backBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Back' });
  const nextBtn = h('button', { type: 'button', class: 'btn btn-primary', text: 'Next' });
  const closeBtn = h('button', { type: 'button', class: 'btn-text tour-close', text: 'Close' });

  const content = h(
    'div',
    { class: 'dialog-body tour', 'data-whats-new': '' },
    h('div', { class: 'tour-head' }, where, closeBtn),
    title,
    points,
    dots,
    position,
    h('div', { class: 'dialog-actions' }, backBtn, nextBtn)
  );

  /** @param {boolean} moveFocus */
  function show(moveFocus) {
    const card = CARDS[index];
    const last = index === CARDS.length - 1;
    where.textContent = card.where;
    title.textContent = card.title;
    points.replaceChildren(...card.points.map((text) => h('li', { text })));
    position.textContent = `${index + 1} of ${CARDS.length}`;
    Array.from(dots.children).forEach((dot, i) => dot.classList.toggle('is-current', i === index));
    backBtn.disabled = index === 0;
    nextBtn.textContent = last ? 'Done' : 'Next';
    // The new card's title is read out when focus lands on it.
    if (moveFocus) title.focus();
  }

  const close = openDialog({ labelId, content, className: 'dialog-tour', initialFocus: nextBtn });
  show(false);
  backBtn.addEventListener('click', () => {
    if (index === 0) return;
    index -= 1;
    show(true);
  });
  nextBtn.addEventListener('click', () => {
    if (index === CARDS.length - 1) {
      close();
      return;
    }
    index += 1;
    show(true);
  });
  closeBtn.addEventListener('click', () => close());
}

/**
 * On launch: opens the walkthrough once for someone who used Kenna before
 * this update (they have logged days and haven't seen these cards). A
 * brand-new user starts with Today's welcome instead, and isn't shown
 * "what's new" later on either.
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
