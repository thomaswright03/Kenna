const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/', 'test-results/', 'playwright-report/', 'docs/build/'] },
  js.configs.recommended,
  {
    files: ['docs/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'readonly', require: 'readonly' },
    },
  },
  {
    files: ['docs/app.js', 'docs/ui/**/*.js'],
    languageOptions: { sourceType: 'module' },
  },
  {
    // The app is built from named pieces small enough to read on their own:
    // its screens, its rules, its storage and its backup files alike.
    files: ['docs/**/*.js'],
    rules: { 'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }] },
  },
  {
    files: ['docs/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    files: ['scripts/**/*.js', 'test/**/*.js', '*.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    files: ['test/e2e/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    rules: {
      'no-unused-vars': ['error', { caughtErrors: 'all' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
];
