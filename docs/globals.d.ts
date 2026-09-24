// Globals docs/data.js puts on `window` for the UI modules.
interface Window {
  KennaCore: typeof import('./core.js');
  KennaLocalStore: typeof import('./store-local.js');
  KennaBackupFile: typeof import('./backup-file.js');
}
