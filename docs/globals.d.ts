// Globals the classic scripts in docs/ put on `window` for the UI modules.
interface Window {
  KennaCore: typeof import('./core.js');
  KennaLocalStore: typeof import('./store-local.js');
  KennaServerStore: typeof import('./store-server.js');
  KennaBackupFile: typeof import('./backup-file.js');
  KENNA_BACKEND?: string;
}
