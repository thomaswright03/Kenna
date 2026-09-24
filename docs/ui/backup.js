// Backup file export and import (Settings).

import { core, h, uid, prefs, today, visibleEntries, plural, formatBytes, errorText, BACKEND } from './dom.js';
import { confirmDialog } from './feedback.js';
import { store } from './store.js';

/**
 * @param {Blob} blob
 * @returns {Promise<string>} the blob's bytes as base64
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** @param {Blob} blob @param {string} filename */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: filename, class: 'visually-hidden' });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * @typedef {{ file: Blob, filename: string, dayCount: number, photoCount: number }} BackupResult
 */

/**
 * Builds a backup file of every day and photo, downloads it and records
 * when it was made.
 * @param {(message: string, done: number, total: number) => void} onProgress
 * @returns {Promise<BackupResult>}
 */
export async function exportBackup(onProgress) {
  onProgress('Preparing backup…', 0, 0);
  const entries = await store.loadEntries();
  /** @type {Record<string, import('../core.js').Entry>} */
  const days = {};
  for (const e of visibleEntries(entries)) days[e.date] = e;
  const photos = await store.listPhotos();
  const encoded = [];
  for (let i = 0; i < photos.length; i += 1) {
    onProgress(`Adding photos: ${i + 1} of ${photos.length}…`, i, photos.length);
    const blob = await store.getPhotoBlob(photos[i]);
    encoded.push({ date: photos[i].date, createdAt: photos[i].createdAt, type: blob.type || photos[i].type, data: await blobToBase64(blob) });
  }
  const file = new Blob(core.serializeBackup(days, encoded, new Date().toISOString()), { type: 'application/json' });
  const filename = `kenna-backup-${today()}.json`;
  downloadBlob(file, filename);
  prefs.set('lastBackupAt', new Date().toISOString());
  return { file, filename, dayCount: Object.keys(days).length, photoCount: photos.length };
}

/** Where to keep a backup file, worded for the version in use. */
export function backupAdvice() {
  return BACKEND === 'server'
    ? 'Keep a copy somewhere other than the computer running Kenna, like cloud storage, a USB drive or email.'
    : 'Move it off this device so it survives losing or replacing it: save it to iCloud Drive or another cloud folder, or email it to yourself.';
}

/** @param {BackupResult} result */
export function backupSummary(result) {
  return `${result.filename}: ${plural(result.dayCount, 'day')} and ${plural(result.photoCount, 'photo')} (${formatBytes(result.file.size)}).`;
}

/**
 * A "Share file…" button for sending the backup straight to Files, a cloud
 * folder or email, where the browser supports sharing files (iPhone and
 * Android do); null elsewhere.
 * @param {BackupResult} result
 */
export function shareBackupButton(result) {
  if (typeof File !== 'function' || !navigator.canShare) return null;
  const file = new File([result.file], result.filename, { type: 'application/json' });
  if (!navigator.canShare({ files: [file] })) return null;
  return h('button', {
    type: 'button',
    class: 'btn btn-secondary',
    text: 'Share file…',
    onClick: () => {
      navigator.share({ files: [file], title: result.filename }).catch(() => {
        // Cancelled or unavailable; the file was downloaded already.
      });
    },
  });
}

export function buildBackupSection() {
  const progress = h('progress', { class: 'progress', max: '1', value: '0', hidden: true });
  const message = h('p', { class: 'field-status', role: 'status' });
  const exportBtn = h('button', { type: 'button', class: 'btn btn-primary', text: 'Export Backup' });
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', id: uid('import') });
  const importLabel = h('label', { class: 'btn btn-secondary file-btn', for: fileInput.id, text: 'Import Backup' });
  const lastLine = h('p', { class: 'card-sub' });
  const shareSlot = h('div');

  function refreshLast() {
    const last = prefs.get('lastBackupAt', null);
    lastLine.textContent = last
      ? `Last backup file saved ${core.formatRelativeDate(core.localDateStr(new Date(last)), today())}.`
      : 'Kenna has no record of a backup file saved from this device.';
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
    shareSlot.replaceChildren();
    try {
      const result = await exportBackup((text, done, total) => {
        setMessage('pending', text);
        setProgress(done, total);
      });
      refreshLast();
      setMessage('saved', `Backup file saved. ${backupSummary(result)} ${backupAdvice()}`);
      const share = shareBackupButton(result);
      if (share) shareSlot.append(share);
    } catch (err) {
      setMessage('error', `Backup not saved. ${errorText(err)}`);
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
    try {
      setMessage('pending', 'Checking backup file…');
      const parsed = core.parseBackup(await file.text());
      if (!parsed.ok) {
        setMessage('error', parsed.error);
        return;
      }
      setMessage(null, '');
      const ok = await confirmDialog({
        title: 'Restore from this backup?',
        message: `It has ${plural(parsed.dayCount, 'day')} and ${plural(
          parsed.photoCount,
          'photo'
        )}. Days in the file replace the same days here; other days and photos stay as they are.`,
        confirmLabel: 'Restore',
      });
      if (!ok) return;
      setMessage('pending', 'Restoring days…');
      const restored = await store.importEntries(parsed.entries);
      let photoResult = { added: 0, skipped: 0 };
      if (parsed.photos.length) {
        setProgress(0, parsed.photos.length);
        photoResult = await store.importPhotos(parsed.photos, (done, total) => {
          setMessage('pending', `Restoring photos: ${done} of ${total}…`);
          setProgress(done, total);
        });
      }
      const skippedNote = photoResult.skipped
        ? ` ${plural(photoResult.skipped, 'photo')} ${photoResult.skipped === 1 ? 'was' : 'were'} already here.`
        : '';
      const summary = `Restored ${plural(restored, 'day')} and ${plural(photoResult.added, 'photo')}.${skippedNote}`;
      setMessage('saved', summary);
    } catch (err) {
      setMessage('error', `Import stopped. ${errorText(err)}`);
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
    shareSlot
  );
}
