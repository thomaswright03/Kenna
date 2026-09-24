// Light, dark or follow-the-system theme, including the browser's
// theme-color so the status bar matches.

import { prefs } from './dom.js';

const THEME_COLORS = { light: '#f8fafc', dark: '#0f172a' };
const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

/** @param {string} pref 'system', 'light' or 'dark' */
export function applyTheme(pref) {
  const choice = pref === 'light' || pref === 'dark' ? pref : 'system';
  const dark = choice === 'dark' || (choice === 'system' && darkQuery !== null && darkQuery.matches);
  const theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePref = choice;
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    const media = meta.getAttribute('data-media') || meta.getAttribute('media');
    if (!meta.getAttribute('data-media') && media) meta.setAttribute('data-media', media);
    const original = meta.getAttribute('data-media') || '';
    if (choice === 'system') {
      meta.setAttribute('media', original);
      meta.setAttribute('content', original.includes('dark') ? THEME_COLORS.dark : THEME_COLORS.light);
    } else {
      meta.removeAttribute('media');
      meta.setAttribute('content', THEME_COLORS[theme]);
    }
  });
}

export function followSystemTheme() {
  if (!darkQuery) return;
  const onSystemChange = () => {
    if (prefs.get('theme', 'system') === 'system') applyTheme('system');
  };
  if (darkQuery.addEventListener) darkQuery.addEventListener('change', onSystemChange);
  else if (darkQuery.addListener) darkQuery.addListener(onSystemChange);
}
