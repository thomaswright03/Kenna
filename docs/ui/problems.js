// The problem log (see core/problems.js): every failure Kenna tells the
// user about is noted here too, with unexpected errors in the code, so
// Settings can show what went wrong and when, and copy it to send to
// whoever looks after Kenna. It stays on the device; nothing is sent
// anywhere by itself.

import { core, h, prefs, today, errorText } from './dom.js';
import { createStatusLine, confirmDialog } from './feedback.js';

const KEY = 'problemLog';
const SHOWN = 5;

/** @typedef {import('../core/problems.js').ProblemEvent} ProblemEvent */

// Events this browser wouldn't let us store (its storage is full, which is
// often the very problem): still shown and copied for this visit.
/** @type {ProblemEvent[]} */
let unsaved = [];

/** @returns {ProblemEvent[]} oldest first */
export function problemLog() {
  const stored = core.parseProblemLog(prefs.get(KEY, null));
  let list = stored;
  for (const e of unsaved) list = core.addProblem(list, e);
  return list;
}

/**
 * Notes a failure: what was being done, and the error's kind (never its
 * message or any logged value).
 * @param {string} op
 * @param {unknown} err
 * @param {{ where?: string | null }} [options]
 */
export function recordProblem(op, err, options) {
  try {
    const event = core.problemEvent(op, err, options);
    const stored = core.parseProblemLog(prefs.get(KEY, null));
    const next = core.addProblem(stored, event);
    try {
      window.localStorage.setItem(`kenna:${KEY}`, JSON.stringify(next));
    } catch {
      unsaved = core.addProblem(unsaved, event);
    }
  } catch {
    // Noting a problem must never cause one.
  }
}

/**
 * The message to show for a failed operation (see errorText), with the
 * failure noted in the problem log.
 * @param {string} op what was being done, in a few words
 * @param {unknown} err
 * @param {string} [fallback]
 */
export function failureText(op, err, fallback) {
  recordProblem(op, err);
  return errorText(err, fallback);
}

export function clearProblemLog() {
  unsaved = [];
  prefs.remove(KEY);
}

/** Notes errors nothing else caught: a mistake in Kenna's own code. */
export function recordUncaughtErrors() {
  window.addEventListener('error', (e) => {
    // Without an error object it's the browser's own notice (a resize
    // loop, a blocked script), not a failure in Kenna.
    if (!e.error) return;
    const where = e.filename ? `${e.filename.split('/').pop()}:${e.lineno}:${e.colno}` : null;
    recordProblem('Unexpected error', e.error, where ? { where } : undefined);
  });
  window.addEventListener('unhandledrejection', (e) => recordProblem('Unexpected error', e.reason));
}

/** @param {string} iso */
function when(iso) {
  const d = new Date(iso);
  const date = core.formatRelativeDate(core.localDateStr(d), today());
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date}, ${time}`;
}

/** The report to paste into a message. */
async function reportText() {
  let app = 'phone app';
  try {
    const names = 'caches' in window ? (await caches.keys()).filter((n) => n.startsWith('kenna')) : [];
    if (names.length) app += `, ${names.join(', ')}`;
  } catch {
    // The version isn't known; the rest still helps.
  }
  return core.problemReport(problemLog(), { app, browser: navigator.userAgent });
}

/** @param {string} text @returns {Promise<boolean>} */
async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the older way.
  }
  const area = h('textarea', { class: 'visually-hidden', readonly: true, 'aria-hidden': 'true' });
  area.value = text;
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

/**
 * Settings: the recent problems, with Copy and Clear.
 * @param {(blob: Blob, filename: string) => void} download used when copying isn't allowed
 */
export function buildProblemLogCard(download) {
  const status = createStatusLine();
  const body = h('div', { class: 'problem-log' });
  const copyBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Copy log' });
  const clearBtn = h('button', { type: 'button', class: 'btn btn-danger-outline', text: 'Clear…' });
  const actions = h('div', { class: 'notice-actions' }, clearBtn, copyBtn);

  function draw() {
    const list = problemLog();
    actions.hidden = list.length === 0;
    if (list.length === 0) {
      body.replaceChildren(h('p', { class: 'card-sub', text: 'Nothing has gone wrong on this device.' }));
      return;
    }
    const newest = [...list].reverse();
    const items = newest.slice(0, SHOWN).map((e) =>
      h(
        'li',
        { 'data-problem': '' },
        h('span', { class: 'problem-op', text: `${e.op}${e.count && e.count > 1 ? ` (${e.count} times)` : ''}` }),
        h('span', { class: 'problem-meta', text: `${when(e.at)} · ${e.error}` })
      )
    );
    const more = list.length - SHOWN;
    body.replaceChildren(h('ul', { class: 'problem-list' }, items));
    if (more > 0) body.append(h('p', { class: 'card-sub', text: `and ${core.formatNumber(more)} earlier. Copy the log to see them all.` }));
  }

  copyBtn.addEventListener('click', async () => {
    const text = await reportText();
    if (await copyText(text)) {
      status.set('saved', 'Copied. Paste it into a message to whoever helps you with Kenna.');
    } else {
      download(new Blob([text], { type: 'text/plain' }), `kenna-problem-log-${today()}.txt`);
      status.set('saved', 'This browser wouldn’t copy, so the log is downloading as a file instead.');
    }
  });
  clearBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Clear the problem log?',
      message: 'Only the list of problems is removed. Your days, photos and backups aren’t affected.',
      confirmLabel: 'Clear',
      danger: true,
    });
    if (!ok) return;
    clearProblemLog();
    draw();
    status.set('saved', 'Problem log cleared.');
  });

  draw();
  return h(
    'section',
    { class: 'card', 'aria-labelledby': 'problem-log-title', 'data-problem-log': '' },
    h('h3', { class: 'section-title', id: 'problem-log-title', text: 'Problem log' }),
    h('p', {
      class: 'card-sub',
      text: `When something fails, Kenna notes what it was doing and when, on this device only: never your weights, meals or photos, and nothing is sent anywhere. If Kenna isn’t working right, copy it into a message to whoever helps you with it. It keeps the last ${core.PROBLEM_LOG_LIMIT}.`,
    }),
    body,
    actions,
    status.el
  );
}
