// Backups on the Today screen. Once anything is logged, a line under the
// day says how old the last saved backup is, with Back up now. Once a few
// days are logged, a card above the day asks for a backup while there is
// none, or the last one is more than a week old; "Not now" puts the
// question off for a few days, and the line still shows the age meanwhile.

import { core, h, uid, prefs, today } from './dom.js';
import { failureText } from './problems.js';
import { announce, createStatusLine } from './feedback.js';
import { exportBackup, buildBackupDelivery, lastBackup } from './backup.js';

const { SNOOZE_DAYS } = core.BACKUP_REMINDER;
const SNOOZE_KEY = 'backupReminderSnoozedUntil';

/**
 * How old the last backup is, as the line on Today says it, and whether
 * it's overdue (the reminder would ask, snoozed or not).
 * @param {number} loggedDays
 */
function backupState(loggedDays) {
  const last = lastBackup();
  const at = last ? last.at : null;
  const age = core.backupAge(at, new Date());
  const overdue = core.backupReminderDue({ loggedDays, lastBackupAt: at, snoozedUntil: null, now: new Date() }) !== null;
  /** @param {number} n */
  const ago = (n) => (n === 0 ? 'today' : n === 1 ? 'yesterday' : `${core.formatNumber(n)} days ago`);
  let text;
  if (!last || age === null) text = 'No backup saved yet';
  else if (last.confirmed) text = `Last backup: ${ago(age)}`;
  else text = `Backup file made ${ago(age)}, not confirmed saved`;
  return { text, overdue };
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
        opts.onSaved(`${title}. Kenna will remind you again in a week.`, title);
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
 * The card asking for a backup, or null when none is due.
 * @param {number} loggedDays days with anything logged
 * @param {() => void} [onGone] runs once the card has been put off or finished with
 * @returns {{ root: HTMLElement, mounted: () => void } | null}
 */
export function buildBackupReminder(loggedDays, onGone) {
  const due = core.backupReminderDue({
    loggedDays,
    lastBackupAt: (lastBackup() || { at: null }).at,
    snoozedUntil: prefs.get(SNOOZE_KEY, null),
    now: new Date(),
  });
  if (!due) return null;

  const titleId = uid('backup-note');
  const headline = due.never ? "You haven't saved a backup yet" : `Your last backup was ${core.formatNumber(due.days)} days ago`;
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
    prefs.set(SNOOZE_KEY, new Date(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000).toISOString());
    gone();
    announce(`Backup reminder hidden for ${SNOOZE_DAYS} days.`);
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
 * @param {number} loggedDays
 * @returns {{ root: HTMLElement, show: () => void }}
 */
export function buildBackupStatus(loggedDays) {
  const titleId = uid('backup-status');
  const root = h('section', { class: 'card card-quiet backup-status', 'aria-labelledby': titleId, 'data-backup-status': '' });

  function draw() {
    const state = backupState(loggedDays);
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
          h('p', { class: 'backup-status-text', text: state.overdue ? 'Save a backup file so your days and photos survive losing this device.' : 'Your days and photos are only on this device.' })
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
 * Days with anything logged: a weight, a meal or a photo.
 * @param {import('../core.js').Entry[]} entries
 * @param {{ date: string }[]} photos
 */
export function loggedDayCount(entries, photos) {
  const now = today();
  const days = new Set(entries.filter((e) => !core.isFutureDate(e.date, now)).map((e) => e.date));
  for (const p of photos) days.add(p.date);
  return days.size;
}
