// The problem log: a short list, kept on the device, of the recent times
// something failed (what was being done, when, and the kind of error), so
// what went wrong can be sent to whoever looks after Kenna. It never holds
// a logged value, a photo or an error's message (a browser's message can
// quote the data it choked on), only names and places in the code.
'use strict';

// The most events kept: the newest.
const PROBLEM_LOG_LIMIT = 30;

/**
 * One recorded failure. `count` is how many times in a row it happened
 * (the time is the latest).
 * @typedef {{ at: string, op: string, error: string, where?: string, count?: number }} ProblemEvent
 */

/** An error's own name ("QuotaExceededError"), or what kind of value was thrown. @param {unknown} err */
function errorName(err) {
  if (err && typeof err === 'object') {
    const name = /** @type {{ name?: unknown }} */ (err).name;
    if (typeof name === 'string' && /^[A-Za-z][\w.$-]{0,59}$/.test(name)) return name;
    return 'object';
  }
  return err === null ? 'null' : typeof err;
}

/**
 * The error's name and the names of the errors behind it, outermost first:
 * "KennaError ← QuotaExceededError".
 * @param {unknown} err
 */
function describeError(err) {
  const names = [errorName(err)];
  let cause = err && typeof err === 'object' ? /** @type {{ cause?: unknown }} */ (err).cause : undefined;
  while (cause !== undefined && names.length < 4) {
    names.push(errorName(cause));
    cause = cause && typeof cause === 'object' ? /** @type {{ cause?: unknown }} */ (cause).cause : undefined;
  }
  return names.join(' ← ');
}

/**
 * Where in Kenna's code the error was raised, as file:line:column (of the
 * built file, which its source map leads back from), or null.
 * @param {unknown} err
 */
function errorPlace(err) {
  const stack = err && typeof err === 'object' ? /** @type {{ stack?: unknown }} */ (err).stack : undefined;
  if (typeof stack !== 'string') return null;
  // Chrome's stack starts with the message, then "    at …" lines; Safari's
  // and Firefox's are all frames ("fn@url:line:col").
  const lines = stack.split('\n');
  const v8Frames = lines.filter((l) => /^\s+at\s/.test(l));
  for (const line of v8Frames.length ? v8Frames : lines) {
    const m = /([\w.-]+\.js):(\d+):(\d+)/.exec(line);
    if (m) return `${m[1]}:${m[2]}:${m[3]}`;
  }
  return null;
}

/**
 * @param {string} op what was being done, in a few words ("Save a meal")
 * @param {unknown} err
 * @param {{ now?: Date, where?: string | null }} [options] where: overrides the place found in the error
 * @returns {ProblemEvent}
 */
function problemEvent(op, err, options) {
  const opts = options || {};
  const event = { at: (opts.now || new Date()).toISOString(), op: String(op).slice(0, 80), error: describeError(err) };
  const where = opts.where !== undefined ? opts.where : errorPlace(err);
  return where ? { ...event, where: String(where).slice(0, 120) } : event;
}

/** @param {unknown} v @returns {v is ProblemEvent} */
function isProblemEvent(v) {
  if (!v || typeof v !== 'object') return false;
  const e = /** @type {Record<string, unknown>} */ (v);
  return (
    typeof e.at === 'string' &&
    !Number.isNaN(Date.parse(e.at)) &&
    typeof e.op === 'string' &&
    typeof e.error === 'string' &&
    (e.where === undefined || typeof e.where === 'string') &&
    (e.count === undefined || (Number.isInteger(e.count) && Number(e.count) >= 1))
  );
}

/**
 * The list with `event` added: the same failure again straight after
 * itself is counted rather than listed twice, and only the newest `limit`
 * are kept.
 * @param {ProblemEvent[]} list oldest first
 * @param {ProblemEvent} event
 * @param {number} [limit]
 * @returns {ProblemEvent[]}
 */
function addProblem(list, event, limit) {
  const max = limit || PROBLEM_LOG_LIMIT;
  const last = list[list.length - 1];
  if (last && last.op === event.op && last.error === event.error && last.where === event.where) {
    return [...list.slice(0, -1), { ...event, count: (last.count || 1) + 1 }];
  }
  return [...list, event].slice(-max);
}

/**
 * The stored list, keeping only well-formed events (the newest `limit`).
 * @param {string | null} text
 * @param {number} [limit]
 * @returns {ProblemEvent[]}
 */
function parseProblemLog(text, limit) {
  if (!text) return [];
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.filter(isProblemEvent).slice(-(limit || PROBLEM_LOG_LIMIT));
}

// What each kind of error means, in words for the person using Kenna. The
// problem log on screen shows these; the copied log keeps the names.
/** @type {Record<string, string>} */
const PLAIN_ERRORS = {
  QuotaExceededError: 'the device’s storage was full',
  NS_ERROR_DOM_QUOTA_REACHED: 'the device’s storage was full',
  StorageBlocked: 'the browser wouldn’t let Kenna save anything',
  SecurityError: 'the browser wouldn’t allow it',
  NotAllowedError: 'the browser wouldn’t allow it',
  DamagedDataRestoredFromCopy: 'saved days were damaged and put back from Kenna’s copy',
  DamagedDataNotRestored: 'saved days were damaged and couldn’t be put back',
  AbortError: 'it was stopped before it finished',
  NotReadableError: 'a file couldn’t be read',
  NotFoundError: 'something Kenna needed wasn’t there',
  InvalidStateError: 'the browser’s storage wasn’t ready',
  UnknownError: 'the browser’s storage reported an error',
  DataError: 'the browser’s storage reported an error',
  TransactionInactiveError: 'the browser’s storage reported an error',
  VersionError: 'the browser’s storage reported an error',
  EncodingError: 'a photo couldn’t be read',
  TypeError: 'a fault in Kenna itself',
  ReferenceError: 'a fault in Kenna itself',
  RangeError: 'a fault in Kenna itself',
  SyntaxError: 'a fault in Kenna itself',
};

/**
 * What went wrong, in plain words, from a recorded error ("KennaError ←
 * QuotaExceededError" is "The device’s storage was full"). The innermost
 * error known here is the reason; Kenna's own wrapper adds nothing to it.
 * @param {string} error a ProblemEvent's error
 */
function plainProblem(error) {
  const names = String(error).split(' ← ').reverse();
  const known = names.find((n) => Object.prototype.hasOwnProperty.call(PLAIN_ERRORS, n));
  const text = known ? PLAIN_ERRORS[known] : 'something unexpected went wrong';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The log as plain text to paste into a message, newest first.
 * @param {ProblemEvent[]} list oldest first
 * @param {{ app: string, browser: string, copiedAt?: Date }} about
 */
function problemReport(list, about) {
  const lines = [`Kenna problem log (${about.app})`, `Browser: ${about.browser}`, `Copied: ${(about.copiedAt || new Date()).toISOString()}`, ''];
  if (list.length === 0) lines.push('Nothing recorded.');
  for (const e of [...list].reverse()) {
    const times = e.count && e.count > 1 ? ` (${e.count} times in a row)` : '';
    lines.push(`${e.at}  ${e.op}: ${e.error}${e.where ? ` at ${e.where}` : ''}${times}`);
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  PROBLEM_LOG_LIMIT,
  problemEvent,
  addProblem,
  parseProblemLog,
  problemReport,
  plainProblem,
};
