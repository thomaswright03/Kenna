// Small DOM and formatting helpers shared by every screen.

/** @typedef {import('../core.js').Entry} Entry */

export const core = window.KennaCore;
export const { MEAL_STEPS } = core;
export const BACKEND = window.KENNA_BACKEND === 'server' ? 'server' : 'local';

/**
 * @typedef {Node | string | null | undefined | false} Child
 * @typedef {Child | Child[] | Child[][]} Children
 */

/**
 * Creates an element. `props` sets attributes, except `class`, `text`
 * (textContent) and `onX` functions (event listeners); null, undefined and
 * false props and children are skipped.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, unknown> | null} [props]
 * @param {...Children} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const key of Object.keys(props)) {
      const v = props[key];
      if (v === null || v === undefined || v === false) continue;
      if (key === 'class') el.className = String(v);
      else if (key === 'text') el.textContent = String(v);
      else if (key.startsWith('on') && typeof v === 'function') el.addEventListener(key.slice(2).toLowerCase(), /** @type {EventListener} */ (v));
      else el.setAttribute(key, v === true ? '' : String(v));
    }
  }
  for (const child of /** @type {Child[]} */ (children.flat(Infinity))) {
    if (child !== null && child !== undefined && child !== false) el.append(child);
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {string} tag
 * @param {Record<string, string | number>} [attrs]
 * @param {string} [text]
 * @returns {SVGElement}
 */
export function svg(tag, attrs, text) {
  const el = /** @type {SVGElement} */ (document.createElementNS(SVG_NS, tag));
  for (const key of Object.keys(attrs || {})) el.setAttribute(key, String(/** @type {Record<string, string | number>} */ (attrs)[key]));
  if (text !== undefined) el.textContent = text;
  return el;
}

let idCounter = 0;
/** @param {string} prefix */
export const uid = (prefix) => `${prefix}-${(idCounter += 1)}`;

/** @param {string} key */
export const mealLabel = (key) => {
  const step = MEAL_STEPS.find((m) => m.key === key);
  return step ? step.label : key;
};

export const today = () => core.todayStr();

/** @param {string} date @returns {Entry} */
export function blankEntry(date) {
  return { date, weight: null, meals: core.emptyMeals() };
}

/** @param {Record<string, Entry>} entries */
export function visibleEntries(entries) {
  return Object.values(entries).filter((e) => !core.isEntryEmpty(e));
}

/** @param {number} n @param {string} word */
export function plural(n, word) {
  return `${core.formatNumber(n)} ${word}${n === 1 ? '' : 's'}`;
}

/** @param {number} n */
export function formatBytes(n) {
  if (n < 1024 * 1024) return `${core.formatNumber(Math.max(1, Math.round(n / 1024)))} KB`;
  return `${core.formatNumber(n / (1024 * 1024), 1)} MB`;
}

/**
 * Per-viewer conveniences (theme, chart range, last backup time). Storage
 * can be unavailable, so every access is guarded and has a default.
 */
export const prefs = {
  /**
   * @template {string | null} T
   * @param {string} key
   * @param {T} fallback
   * @returns {string | T}
   */
  get(key, fallback) {
    try {
      const v = window.localStorage.getItem(`kenna:${key}`);
      return v === null ? fallback : v;
    } catch {
      return fallback;
    }
  },
  /** @param {string} key @param {string} value */
  set(key, value) {
    try {
      window.localStorage.setItem(`kenna:${key}`, value);
    } catch {
      // Not remembered this time; harmless.
    }
  },
  /** @param {string} key */
  remove(key) {
    try {
      window.localStorage.removeItem(`kenna:${key}`);
    } catch {
      // Nothing to do.
    }
  },
};

/** @param {string} id @returns {HTMLElement} */
export function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el;
}

/**
 * The message to show for a failed operation.
 * @param {unknown} err
 */
export function errorText(err) {
  return err instanceof Error && err.message ? err.message : 'Something went wrong. Please try again.';
}
