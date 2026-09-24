// Backups on the Today screen (and, for a new photo, on Photos). Once
// anything is logged, a line under the day says how old the last saved
// backup is, with Back up now. A card asks for a backup once a few days are
// logged and none has been saved, or the last one is older than the
// interval chosen in Settings, and as soon as a photo is added that isn't in
// a saved backup; "Not now" puts the question off until the next day, and
// the line still shows the age meanwhile.

import { core, h, uid, prefs, today } from './dom.js';
import { failureText } from './problems.js';
import { announce, createStatusLine } from './feedback.js';
import { exportBackup, buildBackupDelivery, lastBackup, backupEveryDays, nextReminderText } from './backup.js';

const SNOOZE_KEY = 'backupReminderSnoozedUntil';
const SNOOZE_AT_KEY = 'backupReminderSnoozedAt';

/**
 * What the reminder goes by: the days logged and when each photo was added.
 * @typedef {{ loggedDays: number, photoAddedAt: string[] }} Logged
 */

/**
 * Whether a reminder is due now (see core.backupReminderDue).
 * @param {Logged} logged
 * @param {boolean} [ignoreSnooze] as if "Not now" hadn't been tapped
 */
function reminderDue(logged, ignoreSnooze) {
  const until = prefs.get(SNOOZE_KEY, null);
  return core.backupReminderDue({
    ...logged,
    backup: lastBackup(),
    snooze: until && !ignoreSnooze ? { until, at: prefs.get(SNOOZE_AT_KEY, null) } : null,
    everyDays: backupEveryDays(),
    now: new Date(),
  });
}

/** "today", "yesterday", "3 days ago" @param {number} n */
const ago = (n) => (n === 0 ? 'today' : n === 1 ? 'yesterday' : `${core.formatNumber(n)} days ago`);

/** "A photo isn't", "3 photos aren't" @param {number} n */
const photosArent = (n) => (n === 1 ? 'A photo isn’t' : `${core.formatNumber(n)} photos aren’t`);

/**
 * How old the last backup is, as the line on Today says it, and whether
 * it's overdue (the reminder would ask, put off or not).
 * @param {Logged} logged
 */
function backupState(logged) {
  const last = lastBackup();
  const age = core.backupAge(last ? last.at : null, new Date());
  const due = reminderDue(logged, true);
  let text;
  if (!last || age === null) text = 'No backup saved yet';
  else if (last.confirmed) text = `Last backup: ${ago(age)}`;
  else text = `Backup file made ${ago(age)}, not confirmed saved`;
  let sub = 'Your days and photos are only on this device.';
  if (due && due.photos > 0 && last) sub = `${photosArent(due.photos)} in it: ${due.photos === 1 ? 'it was' : 'they were'} added since. Save a new backup file so they survive losing this device.`;
  else if (due) sub = 'Save a backup file so your days and photos survive losing this device.';
  return { text, sub, overdue: due !== null };
}

/**
 * Makes a backup file and, in place of `root`'s contents, the steps to
 * save it (the share sheet, or a download to confirm), ending with the
 * backup recorded as saved. On failure the contents are put back with the
 * reason under them.
 * @param {HTMLElement} root
 * @param {{ titleId: string, titleClass: string, textClass: string, onSaved: (message: string, title: string) => void }} opts
 */
async function backUpInPlace(root, opts) {
  const before = Array.from(root.childNodes);
  const buttons = Array.from(root.querySelectorAll('button'));
  const status = createStatusLine();
  for (const b of buttons) b.disabled = true;
  root.append(status.el);
  try {
    const result = await exportBackup((text) => status.set('pending', text));
    const delivery = buildBackupDelivery(result, {
      messageClass: opts.textClass,
      onSaved: (how) => {
        const title = how === 'shared' ? 'Backup shared' : 'Backup saved';
        opts.onSaved(`${title}. ${nextReminderText()}`, title);
      },
    });
    root.replaceChildren(h('p', { class: opts.titleClass, id: opts.titleId, text: 'Backup file not saved yet' }), delivery.root);
    announce('Backup file ready, not saved yet.');
    delivery.focus();
  } catch (err) {
    root.replaceChildren(...before);
    for (const b of buttons) b.disabled = false;
    root.append(status.el);
    status.set('error', `Backup not saved. ${failureText('Make a backup', err)}`);
  }
}

/**
 * The card asking for a backup, or null when none is due. On Photos
 * (`photosOnly`) it only asks about photos that aren't in a backup.
 * @param {Logged} logged
 * @param {{ onGone?: () => void, photosOnly?: boolean }} [options] onGone runs once the card has been put off or finished with
 * @returns {{ root: HTMLElement, mounted: () => void } | null}
 */
export function buildBackupReminder(logged, options) {
  const opts = options || {};
  const onGone = opts.onGone;
  const due = reminderDue(logged);
  if (!due || (opts.photosOnly && due.photos === 0)) return null;

  const titleId = uid('backup-note');
  let headline;
  if (due.photos > 0) headline = `${photosArent(due.photos)} in a backup yet`;
  else if (due.never || due.days === null) headline = "You haven't saved a backup yet";
  else headline = `Your last backup was ${ago(due.days)}`;
  const why = 'Your days and photos are stored only on this device. A backup file lets you get them back if it is lost, replaced or cleared.';
  const backupBtn = h('button', { type: 'button', class: 'btn btn-primary', text: 'Back up now' });
  const laterBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Not now' });
  const root = h(
    'section',
    { class: 'card notice-card', 'aria-labelledby': titleId, 'data-backup-reminder': '' },
    h('p', { class: 'notice-title', id: titleId, text: headline }),
    h('p', { class: 'notice-text', text: why }),
    h('div', { class: 'notice-actions' }, laterBtn, backupBtn)
  );
  const gone = () => {
    root.remove();
    if (onGone) onGone();
  };

  laterBtn.addEventListener('click', () => {
    const now = new Date();
    prefs.set(SNOOZE_KEY, core.backupSnoozeEnd(now));
    prefs.set(SNOOZE_AT_KEY, now.toISOString());
    gone();
    announce('Backup reminder hidden until tomorrow.');
  });

  backupBtn.addEventListener('click', () => {
    backupBtn.textContent = 'Backing up…';
    backUpInPlace(root, {
      titleId,
      titleClass: 'notice-title',
      textClass: 'notice-text',
      onSaved: (message, title) => {
        const done = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Done', onClick: gone });
        root.replaceChildren(h('p', { class: 'notice-title', id: titleId, text: title }), h('p', { class: 'notice-text', text: message }), h('div', { class: 'notice-actions' }, done));
        root.classList.add('is-done');
        announce(message);
        done.focus();
      },
    }).finally(() => {
      if (backupBtn.isConnected) backupBtn.textContent = 'Back up now';
    });
  });

  return {
    root,
    mounted: () => announce(`${headline}. ${why}`),
  };
}

/**
 * The line under the day saying how old the last backup is, with Back up
 * now; shown once anything is logged. While the reminder card is showing
 * it says the same, so it stays hidden until that card is gone.
 * @param {Logged} logged
 * @returns {{ root: HTMLElement, show: () => void }}
 */
export function buildBackupStatus(logged) {
  const titleId = uid('backup-status');
  const root = h('section', { class: 'card card-quiet backup-status', 'aria-labelledby': titleId, 'data-backup-status': '' });

  function draw() {
    const state = backupState(logged);
    const button = h('button', { type: 'button', class: 'btn btn-secondary btn-compact', text: 'Back up now' });
    root.classList.toggle('is-overdue', state.overdue);
    root.classList.remove('is-done');
    root.replaceChildren(
      h(
        'div',
        { class: 'backup-status-row' },
        h(
          'div',
          null,
          h('p', { class: 'backup-status-title', id: titleId, text: state.text }),
          h('p', { class: 'backup-status-text', text: state.sub })
        ),
        button
      )
    );
    button.addEventListener('click', () => {
      backUpInPlace(root, {
        titleId,
        titleClass: 'backup-status-title',
        textClass: 'backup-status-text',
        onSaved: (message) => {
          draw();
          root.classList.add('is-done');
          const said = h('p', { class: 'backup-status-text', role: 'status', text: message });
          root.append(said);
          announce(message);
        },
      });
    });
  }
  draw();
  return {
    root,
    show() {
      if (!root.hidden) return;
      root.hidden = false;
      draw();
    },
  };
}

/**
 * What the backup reminder goes by: the days with anything logged (a
 * weight, a meal or a photo), and when each photo was added.
 * @param {import('../core.js').Entry[]} entries
 * @param {{ date: string, createdAt: string }[]} photos
 * @returns {Logged}
 */
export function loggedState(entries, photos) {
  const now = today();
  const days = new Set(entries.filter((e) => !core.isFutureDate(e.date, now)).map((e) => e.date));
  for (const p of photos) days.add(p.date);
  return { loggedDays: days.size, photoAddedAt: photos.map((p) => p.createdAt) };
}
