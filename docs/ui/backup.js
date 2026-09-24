// Backup file export and import (Settings).

import { core, h, uid, prefs, today, visibleEntries, plural, formatBytes, errorText, BACKEND } from './dom.js';
import { confirmDialog } from './feedback.js';
import { store } from './store.js';

/** @param {Blob} blob @param {string} filename */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: filename, class: 'visually-hidden' });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * @typedef {{ file: Blob, filename: string, dayCount: number, photoCount: number }} BackupResult
 */

/**
 * Builds a backup file of every day and photo. Nothing is recorded yet:
 * a backup only counts once it has been saved somewhere (see
 * buildBackupDelivery).
 * @param {(message: string, done: number, total: number) => void} onProgress
 * @returns {Promise<BackupResult>}
 */
export async function exportBackup(onProgress) {
  onProgress('Preparing backup…', 0, 0);
  const entries = await store.loadEntries();
  /** @type {Record<string, import('../core.js').Entry>} */
  const days = {};
  for (const e of visibleEntries(entries)) days[e.date] = core.entryForBackup(e);
  const photos = await store.listPhotos();
  const writer = window.KennaBackupFile.createBackupWriter(days, new Date().toISOString());
  for (let i = 0; i < photos.length; i += 1) {
    onProgress(`Adding photos: ${i + 1} of ${photos.length}…`, i, photos.length);
    const blob = await store.getPhotoBlob(photos[i]);
    writer.addPhoto({ date: photos[i].date, createdAt: photos[i].createdAt, type: blob.type || photos[i].type, data: await core.blobToBase64(blob) });
  }
  onProgress('Creating backup file…', photos.length, photos.length);
  const file = writer.finish();
  return { file, filename: `kenna-backup-${today()}.json`, dayCount: Object.keys(days).length, photoCount: photos.length };
}

// When the last backup file was confirmed saved (a completed share, or the
// user saying the downloaded file is somewhere safe). Versions before that
// check recorded when a download was started, under LEGACY_KEY; that time
// is still read, but never shown as confirmed.
const CONFIRMED_KEY = 'backupConfirmedAt';
const LEGACY_KEY = 'lastBackupAt';

/** @returns {{ at: string, confirmed: boolean } | null} */
export function lastBackup() {
  const confirmed = prefs.get(CONFIRMED_KEY, null);
  if (confirmed && !Number.isNaN(Date.parse(confirmed))) return { at: confirmed, confirmed: true };
  const legacy = prefs.get(LEGACY_KEY, null);
  if (legacy && !Number.isNaN(Date.parse(legacy))) return { at: legacy, confirmed: false };
  return null;
}

/** One line saying when the last backup was saved, for Settings and History. */
export function lastBackupText() {
  const last = lastBackup();
  if (!last) return 'No backup file has been saved from this device yet.';
  const when = core.formatRelativeDate(core.localDateStr(new Date(last.at)), today());
  const day = /^(Today|Yesterday)$/.test(when) ? when.toLowerCase() : `on ${when}`;
  return last.confirmed
    ? `Last backup file saved ${day}.`
    : `A backup file was made ${day}, but Kenna can't tell whether it was saved. Export a new one to be sure.`;
}

function recordBackupSaved() {
  prefs.set(CONFIRMED_KEY, new Date().toISOString());
  prefs.remove('backupReminderSnoozedUntil');
}

/** Where to keep a backup file, worded for the version in use. */
export function backupAdvice() {
  return BACKEND === 'server'
    ? 'Keep a copy somewhere other than the computer running Kenna, like cloud storage, a USB drive or email.'
    : 'Keep it off this device, so it survives losing or replacing it: in iCloud Drive or another cloud folder, or emailed to yourself.';
}

/** @param {BackupResult} result */
export function backupSummary(result) {
  return `${result.filename}: ${plural(result.dayCount, 'day')} and ${plural(result.photoCount, 'photo')} (${formatBytes(result.file.size)})`;
}

/**
 * The backup as a File the browser can hand to the share sheet, or null
 * where sharing files isn't possible (most desktop browsers).
 * @param {BackupResult} result
 * @returns {File | null}
 */
function shareableFile(result) {
  if (typeof File !== 'function' || typeof navigator.canShare !== 'function' || typeof navigator.share !== 'function') return null;
  const file = new File([result.file], result.filename, { type: 'application/json' });
  try {
    return navigator.canShare({ files: [file] }) ? file : null;
  } catch {
    return null;
  }
}

/**
 * What happens to a backup file once it's made. Where the browser can share
 * files (iPhone, Android) the share sheet comes first: Save to Files,
 * iCloud Drive, Mail. Elsewhere the file is downloaded. Either way the
 * backup is recorded as saved only when a share completes or the user
 * confirms the downloaded file is somewhere safe, because a download that
 * was started may still be cancelled or left in a sheet.
 * @param {BackupResult} result
 * @param {{ onSaved: (how: 'shared' | 'confirmed') => void, messageClass?: string }} options
 * @returns {{ root: HTMLElement, focus: () => void }}
 */
export function buildBackupDelivery(result, options) {
  const textClass = options.messageClass || 'card-sub';
  const text = h('p', { class: textClass });
  const actions = h('div', { class: 'notice-actions' });
  const status = h('p', { class: 'field-status', role: 'status' });
  const root = h('div', { class: 'backup-delivery', 'data-backup-delivery': '' }, text, actions, status);
  const file = shareableFile(result);
  /** @type {HTMLElement | null} */
  let focusTarget = null;

  /** @param {'pending' | 'error' | null} tone @param {string} message */
  function setStatus(tone, message) {
    status.className = `field-status${tone ? ` is-${tone}` : ''}`;
    status.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    status.textContent = message;
  }

  /** @param {'shared' | 'confirmed'} how */
  function saved(how) {
    recordBackupSaved();
    options.onSaved(how);
  }

  function showShare() {
    text.textContent = `Backup file ready: ${backupSummary(result)}. It isn't saved anywhere yet: tap Save or share… and choose Save to Files, iCloud Drive or Mail.`;
    const shareBtn = h('button', { type: 'button', class: 'btn btn-primary', text: 'Save or share…' });
    const downloadBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Download instead' });
    shareBtn.addEventListener('click', async () => {
      if (!file || shareBtn.disabled) return;
      shareBtn.disabled = true;
      setStatus(null, '');
      try {
        await navigator.share({ files: [file], title: result.filename });
        saved('shared');
      } catch (err) {
        shareBtn.disabled = false;
        const cancelled = err instanceof Error && err.name === 'AbortError';
        setStatus(
          'error',
          cancelled
            ? 'Not saved: sharing was cancelled. Tap Save or share… again and pick where to keep the file.'
            : "Not saved: this browser couldn't share the file. Tap Download instead."
        );
      }
    });
    downloadBtn.addEventListener('click', () => showDownload());
    actions.replaceChildren(downloadBtn, shareBtn);
    focusTarget = shareBtn;
  }

  function showDownload() {
    downloadBlob(result.file, result.filename);
    text.textContent = `Backup file created: ${backupSummary(result)}. Your browser is downloading it. ${backupAdvice()} Once it’s there, tap I’ve saved it.`;
    const confirmBtn = h('button', { type: 'button', class: 'btn btn-primary', text: 'I’ve saved it' });
    const againBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Download again' });
    confirmBtn.addEventListener('click', () => saved('confirmed'));
    againBtn.addEventListener('click', () => {
      downloadBlob(result.file, result.filename);
      setStatus(null, 'Downloading again…');
    });
    actions.replaceChildren(againBtn, confirmBtn);
    setStatus(null, '');
    focusTarget = confirmBtn;
    confirmBtn.focus();
  }

  if (file) showShare();
  else showDownload();
  return { root, focus: () => focusTarget && focusTarget.focus() };
}

export function buildBackupSection() {
  const progress = h('progress', { class: 'progress', max: '1', value: '0', hidden: true });
  const message = h('p', { class: 'field-status', role: 'status' });
  const exportBtn = h('button', { type: 'button', class: 'btn btn-primary', text: 'Export Backup' });
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', id: uid('import') });
  const importLabel = h('label', { class: 'btn btn-secondary file-btn', for: fileInput.id, text: 'Import Backup' });
  const lastLine = h('p', { class: 'card-sub', 'data-last-backup': '' });
  const deliverySlot = h('div');

  function refreshLast() {
    lastLine.textContent = lastBackupText();
  }
  refreshLast();

  /** @param {'pending' | 'saved' | 'error' | null} tone @param {string} text */
  function setMessage(tone, text) {
    message.className = `field-status${tone ? ` is-${tone}` : ''}`;
    message.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    message.textContent = text;
  }
  /** @param {number} done @param {number} total */
  function setProgress(done, total) {
    progress.hidden = total === 0;
    progress.max = Math.max(1, total);
    progress.value = done;
  }
  /** @param {boolean} on */
  function busy(on) {
    exportBtn.disabled = on;
    fileInput.disabled = on;
    importLabel.classList.toggle('is-disabled', on);
  }

  exportBtn.addEventListener('click', async () => {
    busy(true);
    deliverySlot.replaceChildren();
    try {
      const result = await exportBackup((text, done, total) => {
        setMessage('pending', text);
        setProgress(done, total);
      });
      setMessage(null, '');
      const delivery = buildBackupDelivery(result, {
        onSaved: (how) => {
          refreshLast();
          deliverySlot.replaceChildren();
          setMessage('saved', `${how === 'shared' ? 'Backup shared' : 'Backup saved'}. Kenna will remind you again in a week.`);
        },
      });
      deliverySlot.append(delivery.root);
      delivery.focus();
    } catch (err) {
      setMessage('error', `No backup file was made. ${errorText(err)}`);
    } finally {
      setProgress(0, 0);
      busy(false);
    }
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    busy(true);
    deliverySlot.replaceChildren();
    const backupFile = window.KennaBackupFile;
    try {
      // First pass: check the whole file without changing anything.
      setMessage('pending', 'Checking backup file…');
      const checked = await backupFile.checkBackup(file, {
        onProgress: (n) => setMessage('pending', `Checking backup file: ${plural(n, 'photo')} so far…`),
        latestDay: today(),
      });
      if (!checked.ok) {
        setMessage('error', checked.error);
        return;
      }
      setMessage(null, '');
      const ok = await confirmDialog({
        title: 'Restore from this backup?',
        message: `It has ${plural(checked.dayCount, 'day')} and ${plural(
          checked.photoCount,
          'photo'
        )} (${formatBytes(file.size)}). Days in the file replace the same days here; other days and photos stay as they are.`,
        confirmLabel: 'Restore',
      });
      if (!ok) return;
      setMessage('pending', 'Restoring days…');
      const restored = await store.importEntries(checked.entries);
      // Second pass: add the photos one at a time.
      let added = 0;
      let skipped = 0;
      let futurePhotos = 0;
      if (checked.photoCount > 0) {
        setProgress(0, checked.photoCount);
        const importer = await store.createPhotoImporter();
        await backupFile.forEachBackupPhoto(file, async (photo, n) => {
          // A photo dated after today (a wrong clock) is left out, like such days.
          if (core.isFutureDate(photo.date, today())) futurePhotos += 1;
          else if (await importer.add(photo)) added += 1;
          else skipped += 1;
          setMessage('pending', `Restoring photos: ${n} of ${checked.photoCount}…`);
          setProgress(n, checked.photoCount);
        });
      }
      const skippedNote = skipped ? ` ${plural(skipped, 'photo')} ${skipped === 1 ? 'was' : 'were'} already here.` : '';
      const leftOut = [checked.futureDays ? plural(checked.futureDays, 'day') : '', futurePhotos ? plural(futurePhotos, 'photo') : ''].filter(Boolean);
      const leftOutCount = checked.futureDays + futurePhotos;
      const futureNote = leftOut.length ? ` ${leftOut.join(' and ')} dated after today ${leftOutCount === 1 ? 'was' : 'were'} left out.` : '';
      setMessage('saved', `Restored ${plural(restored, 'day')} and ${plural(added, 'photo')}.${skippedNote}${futureNote}`);
    } catch (err) {
      setMessage(
        'error',
        `Import stopped. ${errorText(err, "Kenna couldn't read the rest of the backup file.")} Days already restored are kept; importing the file again adds the photos that are missing.`
      );
    } finally {
      setProgress(0, 0);
      busy(false);
    }
  });

  return h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card-title', text: 'Backup' }),
    h('p', {
      class: 'card-sub',
      text: 'A backup file holds every day (weight and meal calories) and every progress photo with its date. Importing one restores them; importing the same file twice never duplicates anything.',
    }),
    lastLine,
    exportBtn,
    fileInput,
    importLabel,
    progress,
    message,
    deliverySlot
  );
}
