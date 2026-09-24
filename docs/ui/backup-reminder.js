// A reminder on the Today screen to save a backup file, shown when there is
// logged data and no backup has been saved from this device yet, or the
// last one is more than a week old. "Not now" hides it for a few days.

import { core, h, uid, prefs, BACKEND, errorText } from './dom.js';
import { announce, createStatusLine } from './feedback.js';
import { exportBackup, buildBackupDelivery, lastBackup } from './backup.js';

const { SNOOZE_DAYS } = core.BACKUP_REMINDER;

/**
 * The reminder card, or null when no reminder is due.
 * @param {boolean} hasData
 * @returns {{ root: HTMLElement, mounted: () => void } | null}
 */
export function buildBackupReminder(hasData) {
  const due = core.backupReminderDue({
    hasData,
    lastBackupAt: (lastBackup() || { at: null }).at,
    snoozedUntil: prefs.get('backupReminderSnoozedUntil', null),
    now: new Date(),
  });
  if (!due) return null;

  const titleId = uid('backup-note');
  const headline = due.never ? "You haven't saved a backup yet" : `Your last backup was ${core.formatNumber(due.days)} days ago`;
  const why =
    BACKEND === 'server'
      ? 'Your days and photos are stored only on the computer running Kenna. A backup file lets you get them back if anything happens to it.'
      : 'Your days and photos are stored only on this device. A backup file lets you get them back if it is lost, replaced or cleared.';
  const backupBtn = h('button', { type: 'button', class: 'btn btn-primary', text: 'Back up now' });
  const laterBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Not now' });
  const status = createStatusLine();
  const actions = h('div', { class: 'notice-actions' }, laterBtn, backupBtn);
  const root = h(
    'section',
    { class: 'card notice-card', 'aria-labelledby': titleId, 'data-backup-reminder': '' },
    h('p', { class: 'notice-title', id: titleId, text: headline }),
    h('p', { class: 'notice-text', text: why }),
    actions,
    status.el
  );

  laterBtn.addEventListener('click', () => {
    prefs.set('backupReminderSnoozedUntil', new Date(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000).toISOString());
    root.remove();
    announce(`Backup reminder hidden for ${SNOOZE_DAYS} days.`);
  });

  backupBtn.addEventListener('click', async () => {
    backupBtn.disabled = true;
    laterBtn.disabled = true;
    backupBtn.textContent = 'Backing up…';
    try {
      const result = await exportBackup((text) => status.set('pending', text));
      const title = h('p', { class: 'notice-title', id: titleId, text: 'Backup file not saved yet' });
      const delivery = buildBackupDelivery(result, {
        messageClass: 'notice-text',
        onSaved: (how) => {
          const done = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Done', onClick: () => root.remove() });
          const message = `${how === 'shared' ? 'Backup shared' : 'Backup saved'}. Kenna will remind you again in a week.`;
          root.replaceChildren(
            h('p', { class: 'notice-title', id: titleId, text: how === 'shared' ? 'Backup shared' : 'Backup saved' }),
            h('p', { class: 'notice-text', text: message }),
            h('div', { class: 'notice-actions' }, done)
          );
          root.classList.add('is-done');
          announce(message);
          done.focus();
        },
      });
      root.replaceChildren(title, delivery.root);
      announce('Backup file ready, not saved yet.');
      delivery.focus();
    } catch (err) {
      backupBtn.disabled = false;
      laterBtn.disabled = false;
      backupBtn.textContent = 'Back up now';
      status.set('error', `Backup not saved. ${errorText(err)}`);
    }
  });

  return {
    root,
    mounted: () => announce(`${headline}. ${why}`),
  };
}
