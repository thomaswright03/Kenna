// Kenna core: the data rules shared by the phone app, the server app and the
// server API. Pure functions only (no DOM, no storage). Each concern has its
// own module in core/; this file puts them together as one object, which
// Node gets with require('./docs/core.js') and the page as
// window.KennaCore (npm run build bundles core/ into build/data.js).
//
//   core/errors.js         messages written for the person using Kenna
//   core/dates.js          YYYY-MM-DD dates and how they're written
//   core/numbers.js        calories and weights as shown
//   core/entries.js        a day's entry, read from any version's storage
//   core/stats.js          averages, like-for-like comparison, trends
//   core/input.js          what can be logged, and the messages when not
//   core/backup-format.js  the backup file, and backup reminders
//   core/charts.js         chart periods, averages and axes
//   core/photos.js         image types and base64

/**
 * @typedef {import('./core/entries.js').Entry} Entry
 * @typedef {import('./core/entries.js').EntryPatch} EntryPatch
 * @typedef {import('./core/backup-format.js').BackupPhoto} BackupPhoto
 * @typedef {import('./core/input.js').Validation} Validation
 */

'use strict';

const errors = require('./core/errors.js');
const dates = require('./core/dates.js');
const numbers = require('./core/numbers.js');
const entries = require('./core/entries.js');
const stats = require('./core/stats.js');
const input = require('./core/input.js');
const backup = require('./core/backup-format.js');
const charts = require('./core/charts.js');
const photos = require('./core/photos.js');

// Frozen: nothing may replace these rules at run time, and it lets the
// type checker flag a misspelt name.
module.exports = Object.freeze({
  KennaError: errors.KennaError,
  isQuotaError: errors.isQuotaError,
  STORAGE_FULL: errors.STORAGE_FULL,
  MEAL_STEPS: entries.MEAL_STEPS,
  MEAL_KEYS: entries.MEAL_KEYS,
  LIMITS: input.LIMITS,
  BACKUP_VERSION: backup.BACKUP_VERSION,
  BACKUP_REMINDER: backup.BACKUP_REMINDER,
  IMAGE_EXTENSIONS: photos.IMAGE_EXTENSIONS,
  todayStr: dates.todayStr,
  localDateStr: dates.localDateStr,
  isValidDateStr: dates.isValidDateStr,
  dayNumber: dates.dayNumber,
  dateFromDayNumber: dates.dateFromDayNumber,
  shiftDate: dates.shiftDate,
  isFutureDate: dates.isFutureDate,
  daysBetween: dates.daysBetween,
  formatDate: dates.formatDate,
  isFarBack: dates.isFarBack,
  yearsBetween: dates.yearsBetween,
  formatRelativeDate: dates.formatRelativeDate,
  formatMonth: dates.formatMonth,
  formatMonthDay: dates.formatMonthDay,
  formatNumber: numbers.formatNumber,
  formatCalories: numbers.formatCalories,
  formatWeight: numbers.formatWeight,
  formatAverageWeight: numbers.formatAverageWeight,
  emptyMeals: entries.emptyMeals,
  normalizeMealValue: entries.normalizeMealValue,
  normalizeEntry: entries.normalizeEntry,
  sanitizeEntries: entries.sanitizeEntries,
  isEntryEmpty: entries.isEntryEmpty,
  totalCalories: entries.totalCalories,
  applyPatch: entries.applyPatch,
  computeDayStats: entries.computeDayStats,
  computeAllTimeAverages: stats.computeAllTimeAverages,
  compareSameMeals: stats.compareSameMeals,
  buildDailyRows: stats.buildDailyRows,
  seriesFromRows: stats.seriesFromRows,
  rollingAverage: stats.rollingAverage,
  trendSeries: stats.trendSeries,
  computeMonthAverages: stats.computeMonthAverages,
  validateCalories: input.validateCalories,
  validateWeight: input.validateWeight,
  validateCaloriesValue: input.validateCaloriesValue,
  validatePatch: input.validatePatch,
  validateWeightValue: input.validateWeightValue,
  photoKey: backup.photoKey,
  entryForBackup: backup.entryForBackup,
  backupReminderDue: backup.backupReminderDue,
  checkBackupDays: backup.checkBackupDays,
  checkBackupPhoto: backup.checkBackupPhoto,
  backupProblemsMessage: backup.backupProblemsMessage,
  backupRefusal: backup.backupRefusal,
  compareWithStored: backup.compareWithStored,
  UNREADABLE_BACKUP: backup.UNREADABLE_BACKUP,
  FUTURE_DAY: input.FUTURE_DAY,
  FUTURE_PHOTO: input.FUTURE_PHOTO,
  parseBackup: backup.parseBackup,
  niceTicks: charts.niceTicks,
  axisMinSpan: charts.axisMinSpan,
  CHART_PERIODS: charts.CHART_PERIODS,
  chartPeriod: charts.chartPeriod,
  periodAverages: charts.periodAverages,
  formatPeriod: charts.formatPeriod,
  dateAxisLabels: charts.dateAxisLabels,
  sniffImageType: photos.sniffImageType,
  blobToBase64: photos.blobToBase64,
});
