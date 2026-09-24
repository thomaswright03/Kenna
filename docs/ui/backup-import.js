// Restoring a backup file (Settings → Import Backup): check the whole file,
// say what the restore will change, restore the days and then the photos
// one at a time, and offer to undo it.

import { core, h, today, plural, formatBytes, BACKEND } from './dom.js';
import { failureText } from './problems.js';
import { confirmDialog, itemList, createStatusLine } from './feedback.js';
import { store } from './store.js';

/**
 * The parts of Settings' backup card that import uses.
 * @typedef {object} BackupCardUI
 * @property {import('./feedback.js').StatusLine} status progress and problems
 * @property {(done: number, total: number) => void} setProgress
 * @property {(on: boolean) => void} busy
 * @property {HTMLElement} deliverySlot where a finished export offers to save its file
 * @property {HTMLElement} resultSlot what the last restore did, and its Undo
 */

/**
 * @typedef {{ ok: true, entries: Record<string, import('../core.js').Entry>, dayCount: number, photoCount: number, futureDays: number, skipped: string[] }} CheckedBackup
 * @typedef {{ days: number, daysReplaced: boolean, unchangedDays: number, photos: import('../store-local.js').Photo[], alreadyHere: number, futurePhotos: number }} Restored
 */

/**
 * "3 days and 2 photos", "2 photos and no days", "3 days and no photos".
 * @param {number} days
 * @param {number} photos
 */
export function daysAndPhotos(days, photos) {
  if (days === 0 && photos > 0) return `${plural(photos, 'photo')} and no days`;
  return `${plural(days, 'day')} and ${photos === 0 ? 'no photos' : plural(photos, 'photo')}`;
}

const WHERE = BACKEND === 'server' ? 'in Kenna' : 'on this device';

/**
 * First pass: checks the whole file without changing anything.
 * @param {File} file
 * @param {BackupCardUI} ui
 * @returns {Promise<CheckedBackup | null>} null when it can't be restored (the reason is shown)
 */
async function checkFile(file, ui) {
  ui.status.set('pending', 'Checking backup file…');
  const checked = await window.KennaBackupFile.checkBackup(file, {
    onProgress: (n) => ui.status.set('pending', `Checking backup file: ${plural(n, 'photo')} so far…`),
    latestDay: today(),
  });
  if (!checked.ok) {
    ui.status.set('error', checked.error);
    return null;
  }
  ui.status.set(null);
  return checked;
}

/**
 * What restoring will do to the days already here, in a sentence.
 * @param {CheckedBackup} checked
 */
async function changeSummary(checked) {
  const { replaced, added } = core.compareWithStored(await store.loadEntries(), checked.entries);
  const addedText = `${plural(added.length, 'day')} will be added`;
  if (replaced.length === 0) return added.length ? `${addedText}; no day ${WHERE} will change.` : `Every day in it is already ${WHERE} as it is.`;
  const replacedText = `${plural(replaced.length, 'day')} ${WHERE} will be replaced by the file’s version`;
  return added.length ? `${replacedText}, and ${addedText}.` : `${replacedText}.`;
}

/**
 * @param {File} file
 * @param {CheckedBackup} checked
 */
async function confirmRestore(file, checked) {
  const contents = `It has ${daysAndPhotos(checked.dayCount, checked.photoCount)} (${formatBytes(file.size)}).`;
  const effect =
    checked.dayCount > 0
      ? `${await changeSummary(checked)} Other days and photos stay as they are, and you can undo the restore afterwards.`
      : `No day ${WHERE} will change, and photos already here aren’t added again. You can undo the restore afterwards.`;
  return confirmDialog({
    title: 'Restore from this backup?',
    message: `${contents} ${effect}`,
    details: checked.skipped.length ? { intro: 'These can’t be restored and will be left out:', items: checked.skipped } : null,
    confirmLabel: checked.skipped.length ? 'Restore the rest' : 'Restore',
  });
}

/**
 * Second pass: restores the days, then adds the photos one at a time.
 * `done` records what has been restored so far, for Undo even if the
 * restore stops part-way.
 * @param {File} file
 * @param {CheckedBackup} checked
 * @param {BackupCardUI} ui
 * @param {Restored} done
 */
async function restore(file, checked, ui, done) {
  if (checked.dayCount > 0) {
    ui.status.set('pending', 'Restoring days…');
    // Only days that are new or different are written; a day already here
    // exactly as in the file is left alone and counted as unchanged.
    const { replaced, added, unchanged } = core.compareWithStored(await store.loadEntries(), checked.entries);
    done.unchangedDays = unchanged;
    /** @type {Record<string, import('../core.js').Entry>} */
    const changed = {};
    for (const date of [...replaced, ...added]) changed[date] = checked.entries[date];
    if (replaced.length + added.length > 0) {
      done.daysReplaced = true;
      done.days = await store.importEntries(changed);
    }
  }
  if (checked.photoCount === 0) return;
  ui.setProgress(0, checked.photoCount);
  const importer = await store.createPhotoImporter();
  let n = 0;
  await window.KennaBackupFile.forEachBackupPhoto(file, async (photo) => {
    n += 1;
    // A photo dated after today (a wrong clock) is left out, like such days.
    if (core.isFutureDate(photo.date, today())) done.futurePhotos += 1;
    else {
      const added = await importer.add(photo);
      if (added) done.photos.push(added);
      else done.alreadyHere += 1;
    }
    ui.status.set('pending', `Restoring photos: ${n} of ${checked.photoCount}…`);
    ui.setProgress(n, checked.photoCount);
  });
}

/**
 * "Restored 3 days and 2 photos. 1 day and 1 photo were already here. …"
 * @param {Restored} done
 * @param {CheckedBackup} checked
 */
function restoredText(done, checked) {
  /** @param {string[]} parts @param {number} count */
  const were = (parts, count) => `${parts.join(' and ')} ${count === 1 ? 'was' : 'were'}`;
  const restored = [done.days ? plural(done.days, 'day') : '', done.photos.length ? plural(done.photos.length, 'photo') : ''].filter(Boolean);
  const already = [done.unchangedDays ? plural(done.unchangedDays, 'day') : '', done.alreadyHere ? plural(done.alreadyHere, 'photo') : ''].filter(Boolean);
  const leftOut = [checked.futureDays ? plural(checked.futureDays, 'day') : '', done.futurePhotos ? plural(done.futurePhotos, 'photo') : ''].filter(Boolean);
  const leftOutCount = checked.futureDays + done.futurePhotos;
  return [
    restored.length ? `Restored ${restored.join(' and ')}.` : 'Nothing new to restore.',
    already.length ? `${were(already, done.unchangedDays + done.alreadyHere)} already here.` : '',
    leftOut.length ? `${leftOut.join(' and ')} dated after today ${leftOutCount === 1 ? 'was' : 'were'} left out.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Shows what the restore did (or how far it got), what it left out, and
 * an Undo restore button while there's anything to undo.
 * @param {BackupCardUI} ui
 * @param {{ tone: 'saved' | 'error', text: string, skipped: string[], done: Restored }} outcome
 */
function showOutcome(ui, outcome) {
  const { done } = outcome;
  ui.status.set(null);
  const message = createStatusLine();
  message.set(outcome.tone, outcome.text);
  const skipped = outcome.skipped.length ? [h('p', { class: 'card-sub', text: 'Left out, because it can’t be restored:' }), itemList(outcome.skipped)] : [];
  const canUndo = done.daysReplaced || done.photos.length > 0;
  const undoBtn = canUndo ? h('button', { type: 'button', class: 'btn btn-secondary', text: 'Undo restore' }) : null;
  if (undoBtn) undoBtn.addEventListener('click', () => undoRestore(ui, done));
  ui.resultSlot.replaceChildren(message.el, ...skipped, ...(undoBtn ? [undoBtn] : []));
}

/**
 * Puts the days the restore replaced back exactly as they were (removing
 * days it added) and removes the photos it added.
 * @param {BackupCardUI} ui
 * @param {Restored} done
 */
async function undoRestore(ui, done) {
  ui.busy(true);
  ui.resultSlot.replaceChildren();
  ui.status.set('pending', 'Undoing the restore…');
  try {
    if (done.daysReplaced) await store.undoImport();
    done.daysReplaced = false;
    const photos = done.photos.splice(0);
    for (let i = 0; i < photos.length; i += 1) {
      ui.setProgress(i, photos.length);
      await store.deletePhoto(photos[i].id);
    }
    const removed = photos.length ? `, and the ${plural(photos.length, 'photo')} it added ${photos.length === 1 ? 'was' : 'were'} removed` : '';
    ui.status.set('saved', `Restore undone: your days are as they were before it${removed}.`);
  } catch (err) {
    ui.status.set('error', `The restore couldn’t be fully undone. ${failureText('Undo a restore', err)}`);
    showOutcome(ui, { tone: 'error', text: 'Tap Undo restore to try again.', skipped: [], done });
  } finally {
    ui.setProgress(0, 0);
    ui.busy(false);
  }
}

/**
 * Settings → Import Backup, from picking the file to the result.
 * @param {File} file
 * @param {BackupCardUI} ui
 */
export async function importBackupFile(file, ui) {
  ui.busy(true);
  ui.deliverySlot.replaceChildren();
  ui.resultSlot.replaceChildren();
  /** @type {Restored} */
  const done = { days: 0, daysReplaced: false, unchangedDays: 0, photos: [], alreadyHere: 0, futurePhotos: 0 };
  /** @type {CheckedBackup | null} */
  let checked = null;
  try {
    checked = await checkFile(file, ui);
    if (!checked || !(await confirmRestore(file, checked))) return;
    await restore(file, checked, ui, done);
    showOutcome(ui, { tone: 'saved', text: restoredText(done, checked), skipped: checked.skipped, done });
  } catch (err) {
    const reason = failureText('Import a backup', err, "Kenna couldn't read the rest of the backup file.");
    const changed = done.daysReplaced || done.photos.length > 0;
    const kept = changed ? ' What was restored so far is kept (Undo restore takes it back); importing the file again adds the photos that are missing.' : ' Nothing was changed.';
    showOutcome(ui, { tone: 'error', text: `Import stopped. ${reason}${kept}`, skipped: [], done });
  } finally {
    ui.setProgress(0, 0);
    ui.busy(false);
  }
}
