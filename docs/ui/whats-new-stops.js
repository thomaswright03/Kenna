// The stops of the "What's new" tour (whats-new.js): the screen each is
// on, what it lights up there and what its card says.

import { byId } from './dom.js';

/**
 * @typedef {object} Stop
 * @property {string} where the screen the stop is on, shown above its title
 * @property {string} title
 * @property {string[]} points
 * @property {string} [hash] the screen's address; none keeps the one shown
 * @property {import('./router.js').ScreenName} [screen] the screen `hash` opens
 * @property {() => Element | null} [find] what to light up; none centers the card
 * @property {string} [notYet] added when the feature isn't there yet (nothing logged for it)
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
    find: () => {
      const main = byId('main');
      const picker = main.querySelector('.day-switch');
      const date = main.querySelector('input[type="date"]');
      return picker || (date ? date.closest('.field') : null);
    },
    title: 'View or fix any past day',
    points: ['Tap Change day, beside the day’s name, to see or fix another day. Back to today brings you home.', 'Tapping a day in History opens it too.'],
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
    title: 'Kenna reminds you to back up',
    points: ['When a backup is due, Today says so, with Back up now.', 'Settings shows when you last saved one.'],
    notYet: 'The reminder shows up here on Today when a backup is due.',
  },
  {
    where: 'History',
    hash: '#/history',
    screen: 'history',
    find: inMain('.history-month'),
    title: 'History by month',
    points: ['Days are grouped by month, each with its average calories and weight.', 'Tap a day to open it; Back returns you to this same spot.'],
    notYet: 'Your months show up here once you’ve logged a day.',
  },
  {
    where: 'Compare',
    hash: '#/compare',
    screen: 'compare',
    find: inMain('.compare-answer'),
    title: 'How am I doing today?',
    points: ['Compare answers in plain words: today’s calories against your usual for the same meals, and your weight against your average and yesterday.', 'Each meal’s numbers are one tap further down.'],
    notYet: 'The answers show up here once you’ve logged a day or two.',
  },
  {
    where: 'Photos',
    hash: '#/photos',
    screen: 'photos',
    find: inMain('.file-btn'),
    title: 'Progress photos, filed by day',
    points: ['Every photo is filed under the day it was taken, and you can change its day later in the viewer.', 'Compare photos puts two side by side with each day’s weight.'],
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
