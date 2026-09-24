// The backup file's format and checks, and when to remind about backups.

/**
 * @typedef {import('./entries.js').Entry} Entry
 * @typedef {{ date: string, createdAt: string, type: string, data: string }} BackupPhoto a photo in a backup file (data is base64)
 */
'use strict';

const { isValidDateStr, isFutureDate, daysBetween, localDateStr } = require('./dates.js');
const { MEAL_KEYS, isEntryEmpty, roundWeight } = require('./entries.js');
const { validateIncomingEntry } = require('./input.js');

// Backup file (version 2):
//   { app: "kenna", version: 2, exportedAt, entries: { "YYYY-MM-DD": entry },
//     photos: [ { date, createdAt, type, data /* base64 */ } ] }
// Version-1 files (entries only, no "app"/"version") still import.

const BACKUP_VERSION = 2;
const MAX_BACKUP_ISSUES_SHOWN = 1;

// A day as a backup file holds it. The first version of Kenna stored a
// weight exactly as typed, so a few old days may have more than the two
// decimals the app shows and accepts; those are written as shown (165.33
// for 165.333), so every backup this version makes can be imported again.
/** @param {Entry} entry @returns {Entry} */
function entryForBackup(entry) {
  return { date: entry.date, weight: entry.weight === null ? null : roundWeight(entry.weight), meals: { ...entry.meals } };
}

// A photo's identity across devices and backups is the time it was first
// added, which never changes (its day can be changed later), so a backup
// made before a photo was moved to another day still matches it.
/** @param {{ createdAt: string }} p */
function photoKey(p) {
  return String(p.createdAt);
}

/**
 * Checks everything in a backup except its photos: that it's a Kenna
 * backup this version can read, and every day in it. A day that can't be
 * restored (a value outside the app's rules) is left out and added to
 * `skipped` with the reason, naming the day. Days after `latestDay` (a
 * device clock that was wrong) are left out and counted in `futureDays`.
 * @param {any} payload the backup's top-level object (photos not needed)
 * @param {string[]} skipped
 * @param {string} [latestDay] YYYY-MM-DD; no limit when omitted
 * @returns {{ ok: true, entries: Record<string, Entry>, futureDays: number } | { ok: false, error: string }}
 */
function checkBackupDays(payload, skipped, latestDay) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: "This file isn't a Kenna backup." };
  }
  if (payload.app !== undefined && payload.app !== 'kenna') {
    return { ok: false, error: "This file isn't a Kenna backup." };
  }
  if (typeof payload.version === 'number' && payload.version > BACKUP_VERSION) {
    return { ok: false, error: 'This backup was made by a newer version of Kenna. Update the app, then import it again.' };
  }
  if (!payload.entries || typeof payload.entries !== 'object' || Array.isArray(payload.entries)) {
    return { ok: false, error: "This file isn't a Kenna backup: it has no days in it." };
  }
  /** @type {Record<string, Entry>} */
  const entries = {};
  let futureDays = 0;
  for (const date of Object.keys(payload.entries)) {
    const result = validateIncomingEntry(date, payload.entries[date]);
    if (!result.ok) skipped.push(result.error);
    else if (latestDay && isFutureDate(date, latestDay)) futureDays += 1;
    else entries[date] = result.entry;
  }
  return { ok: true, entries, futureDays };
}

/**
 * Checks one photo from a backup (`n` counts from 1, for messages).
 * @param {any} p
 * @param {number} n
 * @returns {{ ok: true, photo: BackupPhoto } | { ok: false, error: string }}
 */
function checkBackupPhoto(p, n) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, error: `Photo ${n} isn't in the expected format.` };
  if (!isValidDateStr(p.date)) return { ok: false, error: `Photo ${n} has no valid date.` };
  if (typeof p.createdAt !== 'string' || Number.isNaN(Date.parse(p.createdAt))) {
    return { ok: false, error: `Photo ${n} has no valid upload time.` };
  }
  if (typeof p.type !== 'string' || !/^image\/[\w.+-]+$/.test(p.type)) return { ok: false, error: `Photo ${n} isn't an image.` };
  if (typeof p.data !== 'string' || p.data.length === 0 || !/^[A-Za-z0-9+/]+=*$/.test(p.data)) {
    return { ok: false, error: `Photo ${n}'s image data is damaged.` };
  }
  return { ok: true, photo: { date: p.date, createdAt: p.createdAt, type: p.type, data: p.data } };
}

/**
 * The message for a backup with problems (the first one, and how many more).
 * @param {string[]} problems
 */
function backupProblemsMessage(problems) {
  const extra = problems.length > MAX_BACKUP_ISSUES_SHOWN ? ` (and ${problems.length - 1} more problem${problems.length > 2 ? 's' : ''})` : '';
  return `Nothing was imported. ${problems[0]}${extra}`;
}

/**
 * Whether a checked backup has to be refused: only when some of it
 * couldn't be read and nothing else in it can be restored. Otherwise the
 * readable days and photos are restored and the rest listed as skipped.
 * @param {string[]} skipped what couldn't be read, and why
 * @param {number} usable how many days and photos can be restored
 * @returns {string | null} the message to show, or null to go ahead
 */
function backupRefusal(skipped, usable) {
  return skipped.length > 0 && usable === 0 ? backupProblemsMessage(skipped) : null;
}

const UNREADABLE_BACKUP = "This file isn't a Kenna backup: it isn't readable backup data.";

// Validates a whole backup held in memory before anything is changed (the
// server's import, and small files). The app reads backup files in pieces
// instead (backup-file.js), so a large photo library never has to be in
// memory at once; both apply the same checks.
/**
 * @param {unknown} input the file's text, or its parsed JSON
 * @param {string} [latestDay] days after this are left out (see checkBackupDays)
 * @returns {{ ok: true, entries: Record<string, Entry>, photos: BackupPhoto[], dayCount: number, photoCount: number, futureDays: number, skipped: string[] } | { ok: false, error: string }}
 */
function parseBackup(input, latestDay) {
  /** @type {any} */
  let payload = input;
  if (typeof input === 'string') {
    try {
      payload = JSON.parse(input);
    } catch {
      return { ok: false, error: UNREADABLE_BACKUP };
    }
  }
  /** @type {string[]} */
  const skipped = [];
  const days = checkBackupDays(payload, skipped, latestDay);
  if (!days.ok) return days;

  /** @type {BackupPhoto[]} */
  const photos = [];
  if (payload.photos !== undefined) {
    if (!Array.isArray(payload.photos)) {
      skipped.push('The photos section is not in the expected format.');
    } else {
      payload.photos.forEach((/** @type {unknown} */ p, /** @type {number} */ i) => {
        const result = checkBackupPhoto(p, i + 1);
        if (result.ok) photos.push(result.photo);
        else skipped.push(result.error);
      });
    }
  }

  const dayCount = Object.keys(days.entries).length;
  const refused = backupRefusal(skipped, dayCount + photos.length);
  if (refused) return { ok: false, error: refused };
  return { ok: true, entries: days.entries, photos, dayCount, photoCount: photos.length, futureDays: days.futureDays, skipped };
}

/** @param {Entry} a @param {Entry} b */
function sameEntry(a, b) {
  return a.weight === b.weight && MEAL_KEYS.every((k) => (a.meals[k] ?? null) === (b.meals[k] ?? null));
}

/**
 * What restoring `incoming` would do to the days already stored: which
 * differ and would be replaced, which are new, and how many are already
 * exactly the same.
 * @param {Record<string, Entry>} stored
 * @param {Record<string, Entry>} incoming
 * @returns {{ replaced: string[], added: string[], unchanged: number }}
 */
function compareWithStored(stored, incoming) {
  /** @type {string[]} */
  const replaced = [];
  /** @type {string[]} */
  const added = [];
  let unchanged = 0;
  for (const date of Object.keys(incoming).sort()) {
    const here = stored[date];
    if (!here || isEntryEmpty(here)) added.push(date);
    else if (sameEntry(here, incoming[date])) unchanged += 1;
    else replaced.push(date);
  }
  return { replaced, added, unchanged };
}

// When the Today screen reminds the user to save a backup file.
const BACKUP_REMINDER = { REMIND_AFTER_DAYS: 7, SNOOZE_DAYS: 3 };

/**
 * Whether a backup reminder is due, and what it should say. `lastBackupAt`
 * and `snoozedUntil` are ISO times or null.
 * @param {{ hasData: boolean, lastBackupAt: string | null, snoozedUntil: string | null, now: Date }} state
 * @returns {{ never: true } | { never: false, days: number } | null}
 */
function backupReminderDue({ hasData, lastBackupAt, snoozedUntil, now }) {
  if (!hasData) return null;
  if (snoozedUntil && Date.parse(snoozedUntil) > now.getTime()) return null;
  const last = lastBackupAt ? new Date(lastBackupAt) : null;
  if (!last || Number.isNaN(last.getTime())) return { never: true };
  const days = daysBetween(localDateStr(last), localDateStr(now));
  return days >= BACKUP_REMINDER.REMIND_AFTER_DAYS ? { never: false, days } : null;
}

module.exports = {
  BACKUP_VERSION,
  entryForBackup,
  photoKey,
  checkBackupDays,
  checkBackupPhoto,
  backupProblemsMessage,
  backupRefusal,
  UNREADABLE_BACKUP,
  parseBackup,
  compareWithStored,
  BACKUP_REMINDER,
  backupReminderDue,
};
