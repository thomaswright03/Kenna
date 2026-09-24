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

// What to pick instead, said after every "isn't a Kenna backup".
const PICK_BACKUP = 'Pick the file Export Backup saved: its name starts with kenna-backup and ends in .json (look in Files or iCloud Drive).';

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
    return { ok: false, error: `This file isn't a Kenna backup. ${PICK_BACKUP}` };
  }
  if (payload.app !== undefined && payload.app !== 'kenna') {
    return { ok: false, error: `This file isn't a Kenna backup. ${PICK_BACKUP}` };
  }
  if (typeof payload.version === 'number' && payload.version > BACKUP_VERSION) {
    return { ok: false, error: 'This backup was made by a newer version of Kenna. Update the app, then import it again.' };
  }
  if (!payload.entries || typeof payload.entries !== 'object' || Array.isArray(payload.entries)) {
    return { ok: false, error: `This file isn't a Kenna backup: it has no days in it. ${PICK_BACKUP}` };
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

const UNREADABLE_BACKUP = `This file isn't a Kenna backup: it isn't readable backup data. ${PICK_BACKUP}`;

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

/**
 * What restoring a backup's photos would do, from their details alone
 * (no image is read): how many would be added, how many are already here
 * (matched as the importer matches them, by photoKey, which also counts a
 * photo the file holds twice once), and how many are dated after
 * `latestDay` and would be left out.
 * @param {{ date: string, createdAt: string }[]} incoming
 * @param {{ createdAt: string }[]} here the photos on this device
 * @param {string} latestDay
 * @returns {{ added: number, alreadyHere: number, future: number }}
 */
function comparePhotos(incoming, here, latestDay) {
  const seen = new Set(here.map(photoKey));
  let added = 0;
  let alreadyHere = 0;
  let future = 0;
  for (const p of incoming) {
    const key = photoKey(p);
    if (isFutureDate(p.date, latestDay)) future += 1;
    else if (seen.has(key)) alreadyHere += 1;
    else {
      seen.add(key);
      added += 1;
    }
  }
  return { added, alreadyHere, future };
}

// When Kenna asks the user to save a backup file. Once a few days are
// logged (a first meal is too little to ask about), it asks while no backup
// has been saved, and again every EVERY_DAYS days after the last one: every
// day, every 3 days (unless changed) or every week, as chosen in Settings.
// A photo added since the last saved backup is asked about straight away,
// however few days are logged, because a photo can't be logged again.
// "Not now" puts the question off until the next day; a photo added after
// that still brings it back.
const BACKUP_REMINDER = Object.freeze({
  REMIND_FROM_DAYS: 3,
  EVERY_DAYS_CHOICES: Object.freeze([1, 3, 7]),
  DEFAULT_EVERY_DAYS: 3,
  // How long "Not now" put the question off before it lasted until the
  // next day; a put-off time saved then is read with it.
  OLD_SNOOZE_DAYS: 3,
});

/**
 * The reminder interval chosen in Settings (a stored string), or the
 * default when none, or something else, is stored.
 * @param {unknown} stored
 * @returns {number}
 */
function backupEveryDays(stored) {
  const n = Number(stored);
  return BACKUP_REMINDER.EVERY_DAYS_CHOICES.includes(n) ? n : BACKUP_REMINDER.DEFAULT_EVERY_DAYS;
}

/**
 * How many of the photos were added after `since` (an ISO time), so aren't
 * in a backup made then; every photo when there's no such time.
 * @param {string[]} addedAt each photo's createdAt
 * @param {string | null} since
 */
function photosAddedSince(addedAt, since) {
  const from = since ? Date.parse(since) : NaN;
  if (Number.isNaN(from)) return addedAt.length;
  return addedAt.filter((t) => Date.parse(t) > from).length;
}

/**
 * The end of the day `now` is in, as an ISO time: until when "Not now" puts
 * the reminder off.
 * @param {Date} now
 */
function backupSnoozeEnd(now) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
}

/**
 * @typedef {object} BackupReminderState
 * @property {number} loggedDays days with anything logged (a weight, a meal or a photo)
 * @property {{ at: string, covers: string } | null} backup the last saved backup: when it was
 *   saved, and when it was made (what it holds is everything up to then); null for none
 * @property {{ until: string, at: string | null } | null} snooze "Not now": until when, and when it was tapped
 * @property {string[]} photoAddedAt each photo's createdAt
 * @property {number} everyDays the interval chosen in Settings
 * @property {Date} now
 */

/**
 * Whether a backup reminder is due, and what it should say: whether a
 * backup was ever saved, how many days ago the last one was, and how many
 * photos aren't in it. Null when not due.
 * @param {BackupReminderState} state
 * @returns {{ never: boolean, days: number | null, photos: number } | null}
 */
function backupReminderDue({ loggedDays, backup, snooze, photoAddedAt, everyDays, now }) {
  const covers = backup ? backup.covers : null;
  const photos = photosAddedSince(photoAddedAt, covers);
  if (snooze && Date.parse(snooze.until) > now.getTime()) {
    const tapped = snooze.at || new Date(Date.parse(snooze.until) - BACKUP_REMINDER.OLD_SNOOZE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const later = covers && Date.parse(covers) > Date.parse(tapped) ? covers : tapped;
    if (photosAddedSince(photoAddedAt, later) === 0) return null;
  }
  const days = backupAge(backup ? backup.at : null, now);
  const never = days === null;
  if (photos > 0) return { never, days, photos };
  if (loggedDays < BACKUP_REMINDER.REMIND_FROM_DAYS) return null;
  if (never || days >= everyDays) return { never, days, photos };
  return null;
}

/**
 * How many calendar days ago a backup was saved (0 today), or null for
 * none (or an unreadable time).
 * @param {string | null} lastBackupAt ISO time
 * @param {Date} now
 */
function backupAge(lastBackupAt, now) {
  const last = lastBackupAt ? new Date(lastBackupAt) : null;
  if (!last || Number.isNaN(last.getTime())) return null;
  return Math.max(0, daysBetween(localDateStr(last), localDateStr(now)));
}

module.exports = {
  BACKUP_VERSION,
  entryForBackup,
  photoKey,
  checkBackupDays,
  checkBackupPhoto,
  backupRefusal,
  UNREADABLE_BACKUP,
  compareWithStored,
  comparePhotos,
  BACKUP_REMINDER,
  backupEveryDays,
  photosAddedSince,
  backupSnoozeEnd,
  backupReminderDue,
  backupAge,
};
