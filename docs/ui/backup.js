// Backup file export and import (Settings).

import { core, h, uid, prefs, today, visibleEntries, formatBytes, BACKEND } from './dom.js';
import { failureText, recordProblem } from './problems.js';
import { createStatusLine } from './feedback.js';
import { store } from './store.js';
import { importBackupFile, daysAndPhotos } from './backup-import.js';

/** @param {Blob} blob @param {string} filename */
export function downloadBlob(blob, filename) {
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
function backupAdvice() {
  return BACKEND === 'server'
    ? 'Keep a copy somewhere other than the computer running Kenna, like cloud storage, a USB drive or email.'
    : 'Keep it off this device, so it survives losing or replacing it: in iCloud Drive or another cloud folder, or emailed to yourself.';
}

/** "kenna-backup-2026-09-24.json, with 3 days and 2 photos (29 KB)" @param {BackupResult} result */
function backupSummary(result) {
  return `${result.filename}, with ${daysAndPhotos(result.dayCount, result.photoCount)} (${formatBytes(result.file.size)})`;
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
  const status = createStatusLine();
  const root = h('div', { class: 'backup-delivery', 'data-backup-delivery': '' }, text, actions, status.el);
  const file = shareableFile(result);
  /** @type {HTMLElement | null} */
  let focusTarget = null;

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
      status.set(null);
      try {
        await navigator.share({ files: [file], title: result.filename });
        saved('shared');
      } catch (err) {
        shareBtn.disabled = false;
        const cancelled = err instanceof Error && err.name === 'AbortError';
        if (!cancelled) recordProblem('Share a backup', err);
        status.set(
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
      status.set(null, 'Downloading again…');
    });
    actions.replaceChildren(againBtn, confirmBtn);
    status.set(null);
    focusTarget = confirmBtn;
    confirmBtn.focus();
  }

  if (file) showShare();
  else showDownload();
  return { root, focus: () => focusTarget && focusTarget.focus() };
}

/**
 * The export half of Settings' backup card: makes the file, then hands it to
 * the share sheet or the downloads (see buildBackupDelivery).
 * @param {import('./backup-import.js').BackupCardUI} ui
 * @param {() => void} onSaved
 */
async function runExport(ui, onSaved) {
  ui.busy(true);
  ui.deliverySlot.replaceChildren();
  try {
    const result = await exportBackup((text, done, total) => {
      ui.status.set('pending', text);
      ui.setProgress(done, total);
    });
    ui.status.set(null);
    const delivery = buildBackupDelivery(result, {
      onSaved: (how) => {
        onSaved();
        ui.deliverySlot.replaceChildren();
        ui.status.set('saved', `${how === 'shared' ? 'Backup shared' : 'Backup saved'}. Kenna will remind you again in a week.`);
      },
    });
    ui.deliverySlot.append(delivery.root);
    delivery.focus();
  } catch (err) {
    ui.status.set('error', `No backup file was made. ${failureText('Make a backup', err)}`);
  } finally {
    ui.setProgress(0, 0);
    ui.busy(false);
  }
}

export function buildBackupSection() {
  const progress = h('progress', { class: 'progress', max: '1', value: '0', hidden: true });
  const exportBtn = h('button', { type: 'button', class: 'btn btn-primary', text: 'Export Backup' });
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', id: uid('import') });
  const importLabel = h('label', { class: 'btn btn-secondary file-btn', for: fileInput.id, text: 'Import Backup' });
  const lastLine = h('p', { class: 'card-sub', 'data-last-backup': '' });
  const refreshLast = () => {
    lastLine.textContent = lastBackupText();
  };
  refreshLast();

  /** @type {import('./backup-import.js').BackupCardUI} */
  const ui = {
    status: createStatusLine(),
    deliverySlot: h('div'),
    resultSlot: h('div', { class: 'import-result' }),
    setProgress(done, total) {
      progress.hidden = total === 0;
      progress.max = Math.max(1, total);
      progress.value = done;
    },
    busy(on) {
      exportBtn.disabled = on;
      fileInput.disabled = on;
      importLabel.classList.toggle('is-disabled', on);
    },
  };

  exportBtn.addEventListener('click', () => runExport(ui, refreshLast));
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (file) importBackupFile(file, ui);
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
    ui.status.el,
    ui.deliverySlot,
    ui.resultSlot
  );
}
