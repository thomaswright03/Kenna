// The page's copy of the rules, the storage and the backup files: npm run
// build bundles this file and everything it requires into build/data.js,
// which sets window.KennaCore, window.KennaLocalStore and
// window.KennaBackupFile for the interface (build/app.js). Node requires
// core.js, store-local.js and backup-file.js as they are.
'use strict';

self.KennaCore = require('./core.js');
self.KennaLocalStore = require('./store-local.js');
self.KennaBackupFile = require('./backup-file.js');
