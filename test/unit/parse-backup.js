// Reads a whole backup held in memory at once, for stating the backup-file
// rules compactly in the tests. The app reads backup files a piece at a
// time instead (docs/backup-file.js, tested in backup-file.test.js); both
// are built from the same checks in core.
const core = require('../../docs/core.js');

/**
 * @param {unknown} input the file's text, or its parsed JSON
 * @param {string} [latestDay] days after this are left out
 */
function parseBackup(input, latestDay) {
  let payload = input;
  if (typeof input === 'string') {
    try {
      payload = JSON.parse(input);
    } catch {
      return { ok: false, error: core.UNREADABLE_BACKUP };
    }
  }
  const skipped = [];
  const days = core.checkBackupDays(payload, skipped, latestDay);
  if (!days.ok) return days;
  const photos = [];
  if (payload.photos !== undefined) {
    if (!Array.isArray(payload.photos)) {
      skipped.push('The photos section is not in the expected format.');
    } else {
      payload.photos.forEach((p, i) => {
        const result = core.checkBackupPhoto(p, i + 1);
        if (result.ok) photos.push(result.photo);
        else skipped.push(result.error);
      });
    }
  }
  const dayCount = Object.keys(days.entries).length;
  const refused = core.backupRefusal(skipped, dayCount + photos.length);
  if (refused) return { ok: false, error: refused };
  return { ok: true, entries: days.entries, photos, dayCount, photoCount: photos.length, futureDays: days.futureDays, skipped };
}

module.exports = { parseBackup };
