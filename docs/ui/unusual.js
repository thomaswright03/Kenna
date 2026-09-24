// Asking before saving a value far from the user's own history (see
// core/unusual.js): "Keep 4,500 cal for breakfast?", with Keep it and
// Change it. Nothing is saved until the answer is Keep it.

import { confirmDialog } from './feedback.js';

// A box left by a tap (on a tab, another meal, Save and close) is left on
// the tap's pointerdown, before the tap itself arrives. A question opened
// then would take the tap. So it waits until the tap has done what it does:
// Save and close asks itself, and a tab leaves the screen, which keeps the
// value to ask about later (see drafts.js).
let pointerDown = false;
/** @type {(() => void)[]} */
let waiting = [];
const TAP_SETTLE_MS = 50;
document.addEventListener('pointerdown', () => (pointerDown = true), true);
const pointerEnded = () => {
  pointerDown = false;
  const run = waiting;
  waiting = [];
  if (run.length) setTimeout(() => run.forEach((fn) => fn()), TAP_SETTLE_MS);
};
document.addEventListener('pointerup', pointerEnded, true);
document.addEventListener('pointercancel', pointerEnded, true);

/**
 * Runs `fn` once the tap or click under way, if any, has been handled.
 * @param {() => void} fn
 */
export function afterTap(fn) {
  if (pointerDown) waiting.push(fn);
  else setTimeout(fn, 0);
}

/** @typedef {import('../core/unusual.js').Unusual} Unusual */

/**
 * One screen's questions. The same value is asked about once, however many
 * ways it's saved at the same moment (Enter, then the box losing focus to
 * the question), and not again once the user has said to keep it.
 * @param {(field: string, value: number) => Unusual | null} check what to ask about a value for a field ('weight' or a meal), or null
 */
export function unusualGuard(check) {
  /** The values the user said to keep, as field:value. @type {Set<string>} */
  const kept = new Set();
  /** @type {{ id: string, answer: Promise<boolean> } | null} */
  let asking = null;
  return {
    /**
     * What to ask before saving `value`, or null when it can be saved as it is.
     * @param {string} field
     * @param {number | null} value
     */
    question(field, value) {
      if (value === null || kept.has(`${field}:${value}`)) return null;
      return check(field, value);
    },
    /**
     * The user said to keep it (with the Keep it under the box).
     * @param {string} field
     * @param {number} value
     */
    keep(field, value) {
      kept.add(`${field}:${value}`);
    },
    /**
     * Asks; true when the user said to keep it.
     * @param {string} field
     * @param {number} value
     * @param {Unusual} unusual
     */
    async ask(field, value, unusual) {
      const id = `${field}:${value}`;
      if (!asking || asking.id !== id) {
        // Noted before the question opens: opening it moves the focus, which
        // saves the box again (its change event) and must find it asked.
        /** @type {(keep: boolean) => void} */
        let answer = () => undefined;
        asking = { id, answer: new Promise((resolve) => (answer = resolve)) };
        confirmDialog({
          title: unusual.title,
          message: `${unusual.reason} Keep it if it’s right, or change it if it’s a typo.`,
          confirmLabel: 'Keep it',
          cancelLabel: 'Change it',
        }).then(answer);
      }
      const mine = asking;
      const keep = await mine.answer;
      if (asking === mine) asking = null;
      if (keep) kept.add(id);
      return keep;
    },
  };
}

/** @typedef {ReturnType<typeof unusualGuard>} UnusualGuard */
