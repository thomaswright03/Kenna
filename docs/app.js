// Kenna UI. One codebase for both versions: the installable phone app
// (backend "local": localStorage + IndexedDB) and the Node server version
// (backend "server": the /api endpoints). Only the store differs.
(function () {
  'use strict';

  const core = window.KennaCore;
  const { MEAL_STEPS } = core;
  const BACKEND = window.KENNA_BACKEND === 'server' ? 'server' : 'local';

  // ------------------------------------------------------------ small helpers

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const key of Object.keys(props)) {
        const v = props[key];
        if (v === null || v === undefined || v === false) continue;
        if (key === 'class') el.className = v;
        else if (key === 'text') el.textContent = v;
        else if (key.startsWith('on') && typeof v === 'function') el.addEventListener(key.slice(2).toLowerCase(), v);
        else el.setAttribute(key, v === true ? '' : String(v));
      }
    }
    for (const child of children.flat(Infinity)) {
      if (child !== null && child !== undefined && child !== false) el.append(child);
    }
    return el;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, text) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const key of Object.keys(attrs || {})) el.setAttribute(key, attrs[key]);
    if (text !== undefined) el.textContent = text;
    return el;
  }

  let idCounter = 0;
  const uid = (prefix) => `${prefix}-${(idCounter += 1)}`;

  const mealLabel = (key) => MEAL_STEPS.find((m) => m.key === key).label;
  const today = () => core.todayStr();

  // Per-viewer conveniences (theme, chart range, last backup time). Storage
  // can be unavailable, so every access is guarded and has a default.
  const prefs = {
    get(key, fallback) {
      try {
        const v = window.localStorage.getItem(`kenna:${key}`);
        return v === null ? fallback : v;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(`kenna:${key}`, value);
      } catch {
        // Not remembered this time; harmless.
      }
    },
  };

  // ------------------------------------------------------------ store

  const banners = document.getElementById('banners');
  const main = document.getElementById('main');
  const toasts = document.getElementById('toasts');

  function showBanner(notice) {
    const banner = h(
      'div',
      { class: `banner banner-${notice.tone || 'info'}`, role: notice.tone === 'error' ? 'alert' : 'status' },
      h('p', { text: notice.message }),
      h('button', { type: 'button', class: 'btn-text', text: 'Dismiss', onClick: () => banner.remove() })
    );
    banners.append(banner);
  }

  function createStore() {
    if (BACKEND === 'server') return window.KennaServerStore.createServerStore();
    let storage = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    return window.KennaLocalStore.createLocalStore({
      storage,
      indexedDB: window.indexedDB,
      navigator: window.navigator,
      window,
      onNotice: showBanner,
    });
  }

  const store = createStore();

  // ------------------------------------------------------------ toasts

  function toast(message, options) {
    const opts = options || {};
    const el = h('div', { class: `toast${opts.tone === 'error' ? ' toast-error' : ''}`, role: opts.tone === 'error' ? 'alert' : 'status' });
    el.append(h('span', { class: 'toast-text', text: message }));
    let timer = null;
    const dismiss = () => {
      clearTimeout(timer);
      el.remove();
    };
    if (opts.action) {
      el.append(
        h('button', {
          type: 'button',
          class: 'toast-action',
          text: opts.action.label,
          onClick: () => {
            dismiss();
            opts.action.onClick();
          },
        })
      );
    }
    toasts.append(el);
    while (toasts.children.length > 3) toasts.firstChild.remove();
    timer = setTimeout(dismiss, opts.duration || (opts.action ? 7000 : 4000));
    return dismiss;
  }

  // ------------------------------------------------------------ dialogs

  const openDialogs = new Set();

  // A native modal <dialog>: traps focus, closes on Escape, on a tap on the
  // backdrop and via its buttons, and gives focus back to what opened it.
  function openDialog(options) {
    const returnFocus = document.activeElement;
    const dialog = h('dialog', { class: `dialog ${options.className || ''}`, 'aria-labelledby': options.labelId });
    dialog.append(options.content);
    document.body.append(dialog);
    let closed = false;
    const close = (value) => {
      if (closed) return;
      closed = true;
      openDialogs.delete(close);
      if (dialog.open) dialog.close();
      dialog.remove();
      if (options.onClose) options.onClose(value);
      if (returnFocus && document.contains(returnFocus) && typeof returnFocus.focus === 'function') returnFocus.focus();
    };
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(undefined);
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) close(undefined);
    });
    openDialogs.add(close);
    dialog.showModal();
    const first = options.initialFocus ? options.initialFocus : dialog.querySelector('button');
    if (first) first.focus();
    return close;
  }

  function closeAllDialogs() {
    for (const close of Array.from(openDialogs)) close(undefined);
  }

  function confirmDialog({ title, message, confirmLabel, danger }) {
    return new Promise((resolve) => {
      const labelId = uid('dlg');
      const cancelBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel' });
      const okBtn = h('button', { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, text: confirmLabel });
      const content = h(
        'div',
        { class: 'dialog-body' },
        h('h2', { id: labelId, class: 'dialog-title', text: title }),
        message ? h('p', { class: 'dialog-text', text: message }) : null,
        h('div', { class: 'dialog-actions' }, cancelBtn, okBtn)
      );
      const close = openDialog({ labelId, content, initialFocus: cancelBtn, onClose: (v) => resolve(v === true) });
      cancelBtn.addEventListener('click', () => close(false));
      okBtn.addEventListener('click', () => close(true));
    });
  }

  // ------------------------------------------------------------ theme

  const THEME_COLORS = { light: '#f8fafc', dark: '#0f172a' };
  const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function applyTheme(pref) {
    const choice = pref === 'light' || pref === 'dark' ? pref : 'system';
    const dark = choice === 'dark' || (choice === 'system' && darkQuery && darkQuery.matches);
    const theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themePref = choice;
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      const media = meta.getAttribute('data-media') || meta.getAttribute('media');
      if (!meta.getAttribute('data-media') && media) meta.setAttribute('data-media', media);
      if (choice === 'system') {
        meta.setAttribute('media', meta.getAttribute('data-media'));
        meta.setAttribute('content', meta.getAttribute('data-media').includes('dark') ? THEME_COLORS.dark : THEME_COLORS.light);
      } else {
        meta.removeAttribute('media');
        meta.setAttribute('content', THEME_COLORS[theme]);
      }
    });
  }

  if (darkQuery) {
    const onSystemChange = () => {
      if (prefs.get('theme', 'system') === 'system') applyTheme('system');
    };
    if (darkQuery.addEventListener) darkQuery.addEventListener('change', onSystemChange);
    else if (darkQuery.addListener) darkQuery.addListener(onSystemChange);
  }

  // ------------------------------------------------------------ routing
  //
  // Each screen has its own address, so Back moves between screens inside
  // the app and a refresh stays put:
  //   #/                 today          #/day/2026-09-21        a past day
  //   #/log[/meal]       log today      #/day/2026-09-21/log    log a past day
  //   #/history  #/compare  #/photos  #/settings

  const SCREENS = ['history', 'compare', 'photos', 'settings'];

  function parseRoute(hash) {
    const parts = String(hash || '')
      .replace(/^#\/?/, '')
      .split('/')
      .filter(Boolean);
    const mealKey = (k) => (k && core.MEAL_KEYS.includes(k) ? k : null);
    if (parts.length === 0) return { screen: 'today', date: null };
    if (parts[0] === 'log') return { screen: 'log', date: null, meal: mealKey(parts[1]) };
    if (parts[0] === 'day' && core.isValidDateStr(parts[1])) {
      if (parts[2] === 'log') return { screen: 'log', date: parts[1], meal: mealKey(parts[3]) };
      return { screen: 'today', date: parts[1] };
    }
    if (SCREENS.includes(parts[0])) return { screen: parts[0], date: null };
    return { screen: 'today', date: null };
  }

  function dayHash(date) {
    return !date || date === today() ? '#/' : `#/day/${date}`;
  }

  function logHash(date, meal) {
    const base = date ? `#/day/${date}/log` : '#/log';
    return meal ? `${base}/${meal}` : base;
  }

  function routeHash(route) {
    if (route.screen === 'today') return route.date ? `#/day/${route.date}` : '#/';
    if (route.screen === 'log') return logHash(route.date, route.meal);
    return `#/${route.screen}`;
  }

  const currentHash = () => routeHash(parseRoute(window.location.hash));
  let route = parseRoute(window.location.hash);
  const visited = [];
  let replacing = false;

  function onHashChange() {
    const hash = currentHash();
    if (replacing) {
      replacing = false;
      visited[visited.length - 1] = hash;
    } else if (visited.length >= 2 && visited[visited.length - 2] === hash) {
      visited.pop();
    } else {
      visited.push(hash);
    }
    route = parseRoute(hash);
    render({ focus: true });
  }

  function navigate(hash) {
    if (currentHash() === hash) render({ focus: true });
    else window.location.hash = hash;
  }

  // Returns to `hash`: steps back if that's where the user came from (so
  // Back doesn't bounce into the screen just left), otherwise replaces.
  function returnTo(hash) {
    if (visited.length >= 2 && visited[visited.length - 2] === hash) {
      window.history.back();
    } else if (currentHash() !== hash) {
      replacing = true;
      window.location.replace(hash);
    }
  }

  function replaceHashSilently(hash) {
    window.history.replaceState(window.history.state, '', hash);
    visited[visited.length - 1] = hash;
    route = parseRoute(hash);
  }

  function updateTabs() {
    const active = route.screen === 'log' ? 'today' : route.screen;
    document.querySelectorAll('[data-tab]').forEach((tab) => {
      if (tab.dataset.tab === active) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
  }

  // ------------------------------------------------------------ rendering

  let renderSeq = 0;
  let currentView = null;

  // Screens load their data first and only then replace the page, and a
  // newer navigation discards an older one's late results.
  async function render(options) {
    const opts = options || {};
    const seq = (renderSeq += 1);
    const isCurrent = () => seq === renderSeq;
    closeAllDialogs();
    updateTabs();
    main.setAttribute('aria-busy', 'true');
    const releases = [];
    const ctx = { route, isCurrent, onRelease: (fn) => releases.push(fn) };
    let view;
    try {
      view = await SCREEN_BUILDERS[route.screen](ctx);
    } catch (err) {
      view = errorView(err);
    }
    if (!isCurrent()) {
      releases.forEach((fn) => fn());
      return;
    }
    if (currentView && currentView.release) currentView.release();
    view.release = () => releases.forEach((fn) => fn());
    currentView = view;
    main.replaceChildren(view.root);
    main.removeAttribute('aria-busy');
    if (opts.focus) {
      const heading = main.querySelector('h2');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
      window.scrollTo(0, 0);
    }
    if (view.mounted) view.mounted();
  }

  function errorView(err) {
    const message = err && err.message ? err.message : 'Something went wrong.';
    return {
      root: h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title', text: "Couldn't load this screen" }),
        h('p', { class: 'card-sub', role: 'alert', text: message }),
        h('button', { type: 'button', class: 'btn btn-primary', text: 'Try again', onClick: () => render() })
      ),
    };
  }

  // ------------------------------------------------------------ day handling
  //
  // Today's screens follow the calendar: if the app is left open (or resumed
  // from the background) past midnight, it moves to the new day unless the
  // user deliberately opened a specific date.

  let knownToday = today();

  function checkForNewDay() {
    const now = today();
    if (now === knownToday) return false;
    knownToday = now;
    const typing = main.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
    if (!typing) render();
    return true;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForNewDay();
  });
  window.addEventListener('focus', checkForNewDay);
  window.addEventListener('pageshow', checkForNewDay);
  setInterval(checkForNewDay, 30000);

  // The date a save should go to right now. Checked immediately before every
  // save, so a meal logged after midnight lands on the new day.
  function saveDateFor(view) {
    const now = today();
    if (now !== knownToday) knownToday = now;
    if (!route.date && view.date !== now) {
      view.date = now;
      view.rolledOver = true;
    }
    return view.date;
  }

  function blankEntry(date) {
    return { date, weight: null, meals: core.emptyMeals() };
  }

  function visibleEntries(entries) {
    return Object.values(entries).filter((e) => !core.isEntryEmpty(e));
  }

  // ------------------------------------------------------------ field status

  function createFieldStatus(input) {
    const el = h('p', { class: 'field-status', id: uid('status'), 'aria-live': 'polite' });
    input.setAttribute('aria-describedby', el.id);
    let timer = null;
    function set(state, text, retry) {
      clearTimeout(timer);
      el.className = `field-status${state ? ` is-${state}` : ''}`;
      el.replaceChildren();
      if (state === 'error') input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
      if (!text) return;
      // A save can finish after the user has left the screen; say so there.
      if (!el.isConnected && state === 'error') {
        toast(text, { tone: 'error' });
        return;
      }
      el.append(h('span', { text }));
      if (retry) el.append(h('button', { type: 'button', class: 'btn-text', text: 'Retry', onClick: retry }));
      if (state === 'saved') timer = setTimeout(() => set(null), 4000);
    }
    return { el, set };
  }

  // ------------------------------------------------------------ Today screen

  async function buildToday(ctx) {
    const now = today();
    const date = ctx.route.date || now;
    const [storedEntry, allEntries] = await Promise.all([store.getEntry(date), store.loadEntries()]);
    const view = { date, entry: storedEntry || blankEntry(date), rolledOver: false };
    const isToday = date === now;

    const heading = h('h2', { class: 'card-title', text: isToday ? 'Today' : core.formatDate(date, now) });
    const sub = h('p', { class: 'card-sub', text: isToday ? core.formatDate(date, now) : 'Past day' });
    const pastNote = !isToday
      ? h(
          'div',
          { class: 'inline-note' },
          h('span', { text: `You're viewing ${core.formatRelativeDate(date, now)}.` }),
          h('a', { class: 'btn-text', href: '#/', text: 'Back to today' })
        )
      : null;

    // Date
    const dateInput = h('input', { type: 'date', id: uid('date'), value: date, max: now, required: true });
    const dateStatus = createFieldStatus(dateInput);
    dateInput.addEventListener('change', () => {
      const picked = dateInput.value;
      if (!core.isValidDateStr(picked)) {
        dateInput.value = date;
        dateStatus.set('error', 'Pick a date to view.');
        return;
      }
      if (picked > today()) {
        dateInput.value = date;
        dateStatus.set('error', "You can't log a day that hasn't happened yet.");
        return;
      }
      if (picked === date) return;
      navigate(dayHash(picked));
    });
    dateInput.addEventListener('blur', () => {
      if (!dateInput.value) dateInput.value = date;
    });

    // Weight
    const weightInput = h('input', {
      type: 'text',
      inputmode: 'decimal',
      autocomplete: 'off',
      id: uid('weight'),
      placeholder: 'e.g. 180.4',
      value: view.entry.weight === null ? '' : String(view.entry.weight),
    });
    const weightStatus = createFieldStatus(weightInput);
    let weightSaving = null;

    async function commitWeight() {
      const result = core.validateWeight(weightInput.value);
      if (!result.ok) {
        weightStatus.set('error', result.error);
        return false;
      }
      if (result.value === view.entry.weight && !view.rolledOver) {
        if (weightStatus.el.classList.contains('is-error')) weightStatus.set(null);
        return true;
      }
      if (weightSaving) return weightSaving;
      weightSaving = (async () => {
        const target = saveDateFor(view);
        weightStatus.set('pending', 'Saving…');
        try {
          view.entry = await store.updateEntry(target, { weight: result.value });
          weightStatus.set('saved', result.value === null ? 'Weight cleared' : 'Saved');
          if (view.rolledOver) render();
          return true;
        } catch (err) {
          weightStatus.set('error', err.message, () => commitWeight());
          return false;
        } finally {
          weightSaving = null;
        }
      })();
      return weightSaving;
    }
    weightInput.addEventListener('change', commitWeight);
    weightInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitWeight();
      }
    });

    // Calories total + meals
    const totalNum = h('div', { class: 'total-num' });
    const totalLabel = h('div', { class: 'total-label' });
    const mealsList = h('ul', { class: 'meal-list', 'aria-label': 'Meals' });

    function refreshTotal() {
      const total = core.totalCalories(view.entry.meals);
      totalNum.textContent = total === null ? '—' : core.formatNumber(total);
      const when = isToday ? 'today' : core.formatDate(date, today());
      totalLabel.textContent = total === null ? `No meals logged ${isToday ? 'yet today' : `for ${when}`}` : `calories logged ${isToday ? 'today' : `on ${when}`}`;
    }

    async function removeMeal(key, focusAfter) {
      const previous = view.entry.meals[key];
      try {
        view.entry = await store.updateEntry(saveDateFor(view), { meals: { [key]: null } });
      } catch (err) {
        toast(err.message, { tone: 'error' });
        return;
      }
      refreshMeals(key, focusAfter);
      toast(`${mealLabel(key)} removed`, {
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              view.entry = await store.updateEntry(view.date, { meals: { [key]: previous } });
              refreshMeals();
              toast(`${mealLabel(key)} restored`);
            } catch (err) {
              toast(err.message, { tone: 'error' });
            }
          },
        },
      });
    }

    function mealRow(step) {
      const value = view.entry.meals[step.key];
      const logged = value !== null;
      const href = logHash(ctx.route.date, step.key);
      const actions = h('div', { class: 'meal-actions' });
      actions.append(
        h('a', {
          class: 'btn-text',
          href,
          'aria-label': `${logged ? 'Edit' : 'Add'} ${step.label}`,
          text: logged ? 'Edit' : '+ Add',
        })
      );
      if (logged) {
        actions.append(
          h(
            'button',
            {
              type: 'button',
              class: 'icon-btn icon-btn-danger',
              'aria-label': `Remove ${step.label}`,
              'data-remove': step.key,
              onClick: () => removeMeal(step.key, true),
            },
            h('span', { 'aria-hidden': 'true', text: '×' })
          )
        );
      }
      return h(
        'li',
        { class: 'meal-row', 'data-meal': step.key },
        h(
          'div',
          { class: 'meal-info' },
          h('span', { class: 'meal-name', text: step.label }),
          logged
            ? h('span', { class: 'meal-value', text: core.formatCalories(value) })
            : h('span', { class: 'meal-empty', text: 'Not logged' })
        ),
        actions
      );
    }

    function refreshMeals(changedKey, focusAfter) {
      mealsList.replaceChildren(...MEAL_STEPS.map(mealRow));
      refreshTotal();
      if (focusAfter && changedKey) {
        const link = mealsList.querySelector(`[data-meal="${changedKey}"] a`);
        if (link) link.focus();
      }
    }
    refreshMeals();

    const logBtn = h('a', { class: 'btn btn-primary', href: logHash(ctx.route.date, null), text: 'Log Meal' });

    const todayCard = h(
      'section',
      { class: 'card' },
      heading,
      sub,
      pastNote,
      h(
        'div',
        { class: 'field-row' },
        h('div', { class: 'field' }, h('label', { for: dateInput.id, text: 'Date' }), dateInput, dateStatus.el),
        h('div', { class: 'field' }, h('label', { for: weightInput.id, text: 'Weight (lbs)' }), weightInput, weightStatus.el)
      ),
      h('div', { class: 'total-box' }, totalNum, totalLabel),
      mealsList,
      logBtn
    );

    const charts = buildChartsCard({
      title: 'Graphs',
      entries: allEntries,
      smoothing: false,
      footer: h('p', { class: 'card-foot' }, h('a', { class: 'btn-text', href: '#/history', text: 'See exact numbers in History' })),
    });

    return {
      root: h('div', { class: 'screen-stack' }, todayCard, charts.root),
      mounted: charts.draw,
      date,
      async refreshFromStorage() {
        const entry = (await store.getEntry(view.date)) || blankEntry(view.date);
        view.entry = entry;
        if (document.activeElement !== weightInput) weightInput.value = entry.weight === null ? '' : String(entry.weight);
        refreshMeals();
      },
    };
  }

  // ------------------------------------------------------------ Log screen

  async function buildLog(ctx) {
    const now = today();
    const date = ctx.route.date || now;
    const stored = await store.getEntry(date);
    const view = { date, entry: stored || blankEntry(date), rolledOver: false };
    const isToday = date === now;
    const firstOpen = MEAL_STEPS.find((m) => view.entry.meals[m.key] === null);
    let activeKey = ctx.route.meal || (firstOpen ? firstOpen.key : MEAL_STEPS[0].key);

    const input = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', id: uid('cal'), placeholder: 'e.g. 450' });
    const label = h('label', { for: input.id });
    const status = createFieldStatus(input);
    const runningTotal = h('p', { class: 'running-total', 'aria-live': 'polite' });
    const pills = new Map();

    function refreshPills() {
      for (const step of MEAL_STEPS) {
        const pill = pills.get(step.key);
        const value = view.entry.meals[step.key];
        const active = step.key === activeKey;
        pill.className = `meal-pill${active ? ' active' : ''}${value !== null ? ' filled' : ''}`;
        pill.setAttribute('aria-pressed', active ? 'true' : 'false');
        pill.querySelector('.pill-value').textContent = value !== null ? core.formatNumber(value) : '';
        pill.setAttribute('aria-label', value !== null ? `${step.label}, ${core.formatCalories(value)}` : `${step.label}, not logged`);
      }
      const total = core.totalCalories(view.entry.meals);
      runningTotal.textContent = total === null ? 'No meals logged yet' : `Day total: ${core.formatCalories(total)}`;
    }

    function loadInput() {
      const v = view.entry.meals[activeKey];
      input.value = v === null ? '' : String(v);
      label.textContent = `${mealLabel(activeKey)} calories`;
    }

    // The value in the box belongs to the meal it was typed for; saving it
    // updates the pills and total in place (nothing the user might be about
    // to tap is replaced), so the next tap always lands.
    let saving = null;
    function needsSave(result) {
      return result.ok && (result.value !== view.entry.meals[activeKey] || view.rolledOver);
    }

    async function commit() {
      const key = activeKey;
      const result = core.validateCalories(input.value);
      if (!result.ok) {
        status.set('error', result.error);
        return false;
      }
      if (!needsSave(result)) {
        if (status.el.classList.contains('is-error')) status.set(null);
        return true;
      }
      if (saving && saving.key === key && saving.value === result.value) return saving.promise;
      const promise = (async () => {
        const target = saveDateFor(view);
        status.set('pending', 'Saving…');
        try {
          view.entry = await store.updateEntry(target, { meals: { [key]: result.value } });
          if (view.rolledOver) {
            render();
            return true;
          }
          refreshPills();
          if (activeKey === key) status.set('saved', result.value === null ? `${mealLabel(key)} cleared` : `${mealLabel(key)} saved`);
          return true;
        } catch (err) {
          if (activeKey === key) status.set('error', err.message, () => commit());
          else toast(`${mealLabel(key)} not saved. ${err.message}`, { tone: 'error' });
          return false;
        } finally {
          if (saving && saving.promise === promise) saving = null;
        }
      })();
      saving = { key, value: result.value, promise };
      return promise;
    }

    function select(key) {
      activeKey = key;
      status.set(null);
      loadInput();
      refreshPills();
      replaceHashSilently(logHash(ctx.route.date, key));
      input.focus();
    }

    async function switchTo(key) {
      if (key === activeKey) {
        input.focus();
        return;
      }
      const result = core.validateCalories(input.value);
      if (result.ok && !needsSave(result)) {
        select(key); // nothing to save: switch within the same tap
        return;
      }
      if (await commit()) select(key);
    }

    const picker = h('div', { class: 'meal-picker', role: 'group', 'aria-label': 'Meal' });
    for (const step of MEAL_STEPS) {
      const pill = h(
        'button',
        { type: 'button', 'data-meal': step.key, onClick: () => switchTo(step.key) },
        h('span', { class: 'pill-label', text: step.label }),
        h('span', { class: 'pill-value', 'aria-hidden': 'true' })
      );
      pills.set(step.key, pill);
      picker.append(pill);
    }

    input.addEventListener('change', commit);
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (!(await commit())) return;
      const idx = MEAL_STEPS.findIndex((m) => m.key === activeKey);
      const next = MEAL_STEPS.slice(idx + 1).find((m) => view.entry.meals[m.key] === null);
      if (next) select(next.key);
      else doneBtn.focus();
    });

    const doneBtn = h('button', {
      type: 'button',
      class: 'btn btn-primary',
      text: 'Done',
      onClick: async () => {
        if (!(await commit())) {
          input.focus();
          return;
        }
        const total = core.totalCalories(view.entry.meals);
        const when = core.formatRelativeDate(view.date, today());
        toast(total === null ? `Nothing logged for ${when}` : `Saved for ${when}: ${core.formatCalories(total)}`);
        returnTo(dayHash(ctx.route.date));
      },
    });

    loadInput();
    refreshPills();

    const root = h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title', text: 'Log Meal' }),
      h('p', { class: 'card-sub', text: `For ${isToday ? `today, ${core.formatDate(date, now)}` : core.formatDate(date, now)}. Each meal saves as soon as you leave the box.` }),
      picker,
      h('div', { class: 'field' }, label, input, status.el),
      runningTotal,
      doneBtn
    );
    return {
      root,
      mounted: () => {
        if (window.matchMedia && window.matchMedia('(hover: hover)').matches) input.focus({ preventScroll: true });
      },
      async refreshFromStorage() {
        view.entry = (await store.getEntry(view.date)) || blankEntry(view.date);
        if (document.activeElement !== input) loadInput();
        refreshPills();
      },
    };
  }

  // ------------------------------------------------------------ History

  async function buildHistory() {
    const now = today();
    const entries = visibleEntries(await store.loadEntries()).sort((a, b) => (a.date < b.date ? 1 : -1));
    const card = h('section', { class: 'card' }, h('h2', { class: 'card-title', text: 'History' }));
    if (entries.length === 0) {
      card.append(
        h('p', { class: 'empty-hint', text: 'No days logged yet.' }),
        h('a', { class: 'btn btn-primary', href: '#/', text: 'Log today' })
      );
    } else {
      card.append(h('p', { class: 'card-sub', text: 'Tap a day to view or edit it.' }));
      const list = h('ul', { class: 'history-list' });
      for (const e of entries) {
        const total = core.totalCalories(e.meals);
        const parts = [total === null ? 'No meals logged' : core.formatCalories(total)];
        if (e.weight !== null) parts.push(core.formatWeight(e.weight));
        list.append(
          h(
            'li',
            null,
            h(
              'a',
              { class: 'history-item', href: dayHash(e.date), 'data-date': e.date },
              h('span', { class: 'history-date', text: core.formatRelativeDate(e.date, now) }),
              h('span', { class: `history-stats${total === null ? ' is-muted' : ''}`, text: parts.join(' · ') }),
              h('span', { class: 'chevron', 'aria-hidden': 'true', text: '›' })
            )
          )
        );
      }
      card.append(list);
    }
    const last = prefs.get('lastBackupAt', null);
    const backupCard = h(
      'section',
      { class: 'card card-quiet' },
      h('h3', { class: 'section-title', text: 'Backup' }),
      h('p', {
        class: 'card-sub',
        text: last
          ? `Last backup file: ${core.formatDate(core.localDateStr(new Date(last)), now)}.`
          : "You haven't saved a backup file from this device yet.",
      }),
      h('a', { class: 'btn btn-secondary', href: '#/settings', text: 'Back up or restore' })
    );
    return { root: h('div', { class: 'screen-stack' }, card, backupCard) };
  }

  // ------------------------------------------------------------ Compare

  function formatMetric(value, unit) {
    return unit === 'lbs' ? core.formatWeight(value) : core.formatCalories(value);
  }

  function formatDelta(diff, unit) {
    const rounded = unit === 'lbs' ? Math.round(diff * 10) / 10 : Math.round(diff);
    const arrow = rounded > 0 ? '▲' : rounded < 0 ? '▼' : '=';
    const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
    return `${arrow} ${sign}${formatMetric(Math.abs(rounded), unit)}`;
  }

  function compareRow(catLabel, value, unit, maxVal, isToday, emptyText) {
    const row = h('div', { class: `compare-row${isToday ? ' is-today' : ''}` }, h('div', { class: 'compare-cat', text: catLabel }));
    if (value === null || value === undefined) {
      row.append(h('div', { class: 'compare-empty', text: emptyText }));
      return row;
    }
    const pct = maxVal > 0 ? Math.max((value / maxVal) * 100, value > 0 ? 3 : 0) : 0;
    row.append(
      h('div', { class: 'compare-track' }, h('div', { class: `compare-bar${isToday ? ' is-today' : ''}`, style: `width:${pct}%` })),
      h('div', { class: 'compare-value', text: formatMetric(value, unit) })
    );
    return row;
  }

  function compareMetric(metric, t, y, avg) {
    const values = [t, y, avg].filter((v) => v !== null && v !== undefined);
    const maxVal = values.length ? Math.max(...values, 0) : 0;
    const parts = [];
    if (t !== null && y !== null) parts.push(`${formatDelta(t - y, metric.unit)} vs yesterday`);
    if (t !== null && avg !== null) parts.push(`${formatDelta(t - avg, metric.unit)} vs average`);
    let caption = parts.join(' · ');
    if (!caption) caption = t === null ? `${metric.emptyToday} yet today.` : 'Not enough history to compare yet.';
    return h(
      'div',
      { class: 'compare-metric' },
      h('h3', { class: 'compare-label', text: metric.label }),
      compareRow('Today', t, metric.unit, maxVal, true, metric.empty),
      compareRow('Yesterday', y, metric.unit, maxVal, false, metric.empty),
      compareRow('All-time avg', avg, metric.unit, maxVal, false, metric.empty),
      h('p', { class: 'compare-caption', text: caption })
    );
  }

  async function buildCompare() {
    const now = today();
    const entries = await store.loadEntries();
    const todayStats = core.computeDayStats(entries[now]);
    const yStats = core.computeDayStats(entries[core.shiftDate(now, -1)]);
    const avgs = core.computeAllTimeAverages(entries, now);
    const metrics = [
      { key: 'weight', label: 'Weight', unit: 'lbs', empty: 'No weight logged', emptyToday: 'No weight logged' },
      { key: 'total', label: 'Total calories', unit: 'cal', empty: 'No meals logged', emptyToday: 'No meals logged' },
      ...MEAL_STEPS.map((m) => ({ key: m.key, label: m.label, unit: 'cal', empty: 'Not logged', emptyToday: `${m.label} not logged`, optional: true })),
    ];
    const card = h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title', text: 'Compare' }),
      h('p', { class: 'card-sub', text: `Today (${core.formatDate(now, now)}) against yesterday and your all-time average. Averages leave out today and days with nothing logged.` }),
      ...metrics
        .filter((m) => !m.optional || [todayStats[m.key], yStats[m.key], avgs[m.key]].some((v) => v !== null))
        .map((m) => compareMetric(m, todayStats[m.key], yStats[m.key], avgs[m.key]))
    );
    const neverLogged = metrics.filter((m) => m.optional && [todayStats[m.key], yStats[m.key], avgs[m.key]].every((v) => v === null));
    if (neverLogged.length) {
      card.append(h('p', { class: 'compare-caption', text: `Never logged, so nothing to compare: ${neverLogged.map((m) => m.label).join(', ')}.` }));
    }
    const trends = buildChartsCard({ title: 'Trends', entries, smoothing: true });
    return { root: h('div', { class: 'screen-stack' }, card, trends.root), mounted: trends.draw };
  }

  // ------------------------------------------------------------ charts

  const RANGES = [
    { key: '30', label: '30 days', days: 30 },
    { key: '90', label: '90 days', days: 90 },
    { key: 'all', label: 'All', days: null },
  ];

  const activeCharts = new Set();
  let resizeTimer = null;
  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      activeCharts.forEach((redraw) => redraw());
    }, 150);
  });

  // A card with the Calories and Weight charts and a shared range picker.
  // `smoothing` plots the 7-day rolling average instead of daily values.
  function buildChartsCard({ title, entries, smoothing, footer }) {
    const rows = core.buildDailyRows(entries);
    let rangeKey = prefs.get('chartRange', '30');
    if (!RANGES.some((r) => r.key === rangeKey)) rangeKey = '30';

    const series = [
      { field: 'calories', title: 'Calories', unit: 'cal', sub: smoothing ? '7-day average of daily intake' : 'Total intake each day' },
      { field: 'weight', title: 'Weight', unit: 'lbs', sub: smoothing ? '7-day average weight' : 'Weight each day' },
    ].map((s) => {
      const daily = core.seriesFromRows(rows, s.field);
      return { ...s, points: smoothing ? core.rollingAverage(daily, 7) : daily, host: h('div', { class: 'chart' }) };
    });

    const buttons = RANGES.map((r) =>
      h('button', {
        type: 'button',
        class: 'segment',
        'data-range': r.key,
        'aria-pressed': r.key === rangeKey ? 'true' : 'false',
        text: r.label,
        onClick: () => {
          rangeKey = r.key;
          prefs.set('chartRange', r.key);
          buttons.forEach((b) => b.setAttribute('aria-pressed', b.dataset.range === r.key ? 'true' : 'false'));
          draw();
        },
      })
    );

    function draw() {
      const range = RANGES.find((r) => r.key === rangeKey);
      for (const s of series) drawChart(s.host, s.points, { ...s, rangeDays: range.days });
    }

    const root = h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'card-head' },
        h('h2', { class: 'card-title', text: title }),
        h('div', { class: 'segmented', role: 'group', 'aria-label': 'Chart range' }, buttons)
      ),
      ...series.map((s) => s.host),
      footer || null
    );

    return {
      root,
      draw: () => {
        activeCharts.clear();
        activeCharts.add(draw);
        draw();
      },
    };
  }

  // Line chart with a real time axis: each point sits at its calendar date,
  // so days without data show as gaps (dashed where the line bridges them).
  // It always ends at today, so the latest data is what's on screen.
  function drawChart(host, points, opts) {
    const now = today();
    const endDay = core.dayNumber(now);
    const firstDay = points.length ? core.dayNumber(points[0].date) : endDay;
    const startDay = opts.rangeDays ? endDay - opts.rangeDays + 1 : Math.min(firstDay, endDay - 6);
    const visible = points.filter((p) => {
      const d = core.dayNumber(p.date);
      return d >= startDay && d <= endDay;
    });
    const fmt = (v) => (opts.unit === 'lbs' ? core.formatWeight(v) : core.formatCalories(v));

    const latest = visible[visible.length - 1];
    const head = h(
      'div',
      { class: 'chart-head' },
      h('div', null, h('h3', { class: 'chart-title', text: opts.title }), h('p', { class: 'chart-sub', text: opts.sub })),
      latest ? h('div', { class: `chart-latest series-${opts.field}` }, h('span', { text: fmt(latest.value) }), h('span', { class: 'chart-latest-date', text: core.formatRelativeDate(latest.date, now) })) : null
    );
    host.replaceChildren(head);

    if (visible.length === 0) {
      host.append(
        h('p', {
          class: 'empty-hint',
          text: points.length === 0 ? 'Nothing logged yet.' : `Nothing logged in the last ${opts.rangeDays} days. Choose All to see older data.`,
        })
      );
      return;
    }

    const width = Math.max(260, host.clientWidth || 320);
    const height = 220;
    const values = visible.map((p) => p.value);
    const { ticks, decimals } = core.niceTicks(Math.min(...values), Math.max(...values), 5, opts.unit === 'lbs' ? 0.1 : 1);
    const tickText = ticks.map((t) => core.formatNumber(t, decimals));
    const leftPad = 12 + Math.max(...tickText.map((t) => t.length)) * 7.5;
    const rightPad = 12;
    const topPad = 12;
    const bottomPad = 28;
    const plotW = width - leftPad - rightPad;
    const plotH = height - topPad - bottomPad;
    const yMin = ticks[0];
    const yMax = ticks[ticks.length - 1];
    const span = Math.max(1, endDay - startDay);
    const x = (day) => leftPad + ((day - startDay) / span) * plotW;
    const y = (v) => topPad + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

    const summary = `${opts.title} chart, ${opts.rangeDays ? `last ${opts.rangeDays} days` : 'all time'}: ${visible.length} day${visible.length === 1 ? '' : 's'} with data, latest ${fmt(latest.value)} on ${core.formatDate(latest.date, now)}. Use the arrow keys to read each point.`;
    const chart = svg('svg', {
      class: `chart-svg series-${opts.field}`,
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      tabindex: '0',
      'aria-label': summary,
    });

    ticks.forEach((t, i) => {
      chart.append(svg('line', { class: 'gridline', x1: leftPad, x2: width - rightPad, y1: y(t), y2: y(t) }));
      chart.append(svg('text', { class: 'axis-label', x: leftPad - 6, y: y(t) + 4, 'text-anchor': 'end' }, tickText[i]));
    });

    const labelCount = Math.min(4, span + 1);
    const withYear = String(core.dateFromDayNumber(startDay)).slice(0, 4) !== now.slice(0, 4);
    for (let k = 0; k < labelCount; k += 1) {
      const day = Math.round(startDay + (k * span) / Math.max(1, labelCount - 1));
      const anchor = k === 0 ? 'start' : k === labelCount - 1 ? 'end' : 'middle';
      chart.append(
        svg('text', { class: 'axis-label', x: x(day), y: height - 8, 'text-anchor': anchor }, core.formatMonthDay(core.dateFromDayNumber(day), withYear && k === 0))
      );
    }

    // Solid line between consecutive days; dashed across skipped days.
    let solid = [];
    const flush = () => {
      if (solid.length > 1) chart.append(svg('polyline', { class: 'line', points: solid.join(' ') }));
      solid = [];
    };
    visible.forEach((p, i) => {
      const day = core.dayNumber(p.date);
      const pt = `${x(day)},${y(p.value)}`;
      if (i > 0) {
        const prev = visible[i - 1];
        const prevDay = core.dayNumber(prev.date);
        if (day - prevDay > 1) {
          flush();
          chart.append(svg('line', { class: 'line-gap', x1: x(prevDay), y1: y(prev.value), x2: x(day), y2: y(p.value) }));
        }
      }
      solid.push(pt);
    });
    flush();

    const showAllDots = visible.length <= 45;
    visible.forEach((p, i) => {
      if (showAllDots || i === visible.length - 1) {
        chart.append(svg('circle', { class: 'dot', cx: x(core.dayNumber(p.date)), cy: y(p.value), r: i === visible.length - 1 ? 4.5 : 3.5 }));
      }
    });

    const crosshair = svg('line', { class: 'crosshair', y1: topPad, y2: topPad + plotH, visibility: 'hidden' });
    const hoverDot = svg('circle', { class: 'dot dot-hover', r: 6, visibility: 'hidden' });
    chart.append(crosshair, hoverDot);

    const tooltip = h('div', { class: 'chart-tooltip', 'aria-live': 'polite' });
    const plotWrap = h('div', { class: 'chart-plot' }, chart, tooltip);
    host.append(plotWrap);

    let current = -1;
    function show(i) {
      current = Math.max(0, Math.min(visible.length - 1, i));
      const p = visible[current];
      const cx = x(core.dayNumber(p.date));
      const cy = y(p.value);
      crosshair.setAttribute('x1', cx);
      crosshair.setAttribute('x2', cx);
      crosshair.setAttribute('visibility', 'visible');
      hoverDot.setAttribute('cx', cx);
      hoverDot.setAttribute('cy', cy);
      hoverDot.setAttribute('visibility', 'visible');
      tooltip.replaceChildren(h('div', { class: 'tt-value', text: fmt(p.value) }), h('div', { class: 'tt-date', text: core.formatDate(p.date, now) }));
      tooltip.style.left = `${Math.min(Math.max(cx, 60), width - 60)}px`;
      tooltip.style.top = `${cy}px`;
      tooltip.classList.add('visible');
    }
    function hide() {
      current = -1;
      crosshair.setAttribute('visibility', 'hidden');
      hoverDot.setAttribute('visibility', 'hidden');
      tooltip.classList.remove('visible');
    }
    function nearest(clientX) {
      const rect = chart.getBoundingClientRect();
      const px = ((clientX - rect.left) / rect.width) * width;
      let best = 0;
      let bestDist = Infinity;
      visible.forEach((p, i) => {
        const d = Math.abs(x(core.dayNumber(p.date)) - px);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      return best;
    }
    chart.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
    chart.addEventListener('pointerdown', (e) => show(nearest(e.clientX)));
    chart.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') hide();
    });
    chart.addEventListener('keydown', (e) => {
      const moves = { ArrowLeft: -1, ArrowRight: 1 };
      if (e.key in moves) {
        e.preventDefault();
        show(current === -1 ? visible.length - 1 : current + moves[e.key]);
      } else if (e.key === 'Home') {
        e.preventDefault();
        show(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        show(visible.length - 1);
      } else if (e.key === 'Escape') {
        hide();
      }
    });
    chart.addEventListener('blur', hide);
  }

  // ------------------------------------------------------------ Photos

  function readHead(file, n) {
    return file
      .slice(0, n)
      .arrayBuffer()
      .then((buf) => new Uint8Array(buf));
  }

  function decodeImage(file) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => resolve({ img, release: () => URL.revokeObjectURL(url) });
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  // Downscales and re-encodes so a multi-megabyte phone photo doesn't eat
  // storage. A real photo format this browser can't re-encode (e.g. HEIC in
  // some browsers) is kept as-is; anything that isn't an image is refused.
  async function preparePhoto(file, maxDim) {
    const sniffed = core.sniffImageType(await readHead(file, 32));
    const decoded = await decodeImage(file);
    if (!decoded) {
      if (sniffed) return new Blob([file], { type: sniffed });
      throw new Error("That file isn't a photo we can show.");
    }
    const { img, release } = decoded;
    let { naturalWidth: w, naturalHeight: hgt } = img;
    if (!w || !hgt) {
      release();
      throw new Error("That file isn't a photo we can show.");
    }
    if (w > maxDim || hgt > maxDim) {
      const scale = maxDim / Math.max(w, hgt);
      w = Math.round(w * scale);
      hgt = Math.round(hgt * scale);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = hgt;
    canvas.getContext('2d').drawImage(img, 0, 0, w, hgt);
    release();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (blob) return blob;
    if (sniffed) return new Blob([file], { type: sniffed });
    throw new Error("That file isn't a photo we can show.");
  }

  async function buildPhotos(ctx) {
    const now = today();
    const photos = await store.listPhotos();
    const where = BACKEND === 'server' ? 'on the Kenna server' : 'on this device';

    const status = h('p', { class: 'field-status', role: 'status' });
    const fileInput = h('input', { type: 'file', accept: 'image/*,.heic,.heif', class: 'visually-hidden', id: uid('upload') });
    const uploadLabel = h('label', { class: 'btn btn-primary file-btn', for: fileInput.id, text: 'Add Photo' });

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      status.className = 'field-status is-pending';
      status.textContent = 'Saving photo…';
      try {
        const blob = await preparePhoto(file, 1600);
        await store.addPhoto({ date: today(), blob, createdAt: new Date().toISOString() });
        toast('Photo added');
        render();
      } catch (err) {
        status.className = 'field-status is-error';
        status.textContent = err.message || "Couldn't save that photo. Try again.";
      }
    });

    const intro = h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title', text: 'Progress Photos' }),
      h('p', {
        class: 'card-sub',
        text: `Each photo is filed under the day you add it (today is ${core.formatDate(now, now)}). Photos are kept ${where} and are included in your backup file.`,
      }),
      fileInput,
      uploadLabel,
      status
    );

    const stack = h('div', { class: 'screen-stack' }, intro);
    if (photos.length === 0) {
      stack.append(h('section', { class: 'card' }, h('p', { class: 'empty-hint', text: 'No photos yet.' })));
      return { root: stack };
    }

    const groups = [];
    for (const p of photos) {
      let group = groups.find((g) => g.date === p.date);
      if (!group) {
        group = { date: p.date, items: [] };
        groups.push(group);
      }
      group.items.push(p);
    }
    groups.sort((a, b) => (a.date < b.date ? 1 : -1));

    for (const group of groups) {
      const dateLabel = core.formatRelativeDate(group.date, now);
      const grid = h('div', { class: 'photo-grid' });
      for (const p of group.items) {
        const src = store.photoSrc(p);
        ctx.onRelease(src.release);
        const img = h('img', { src: src.url, alt: `Progress photo, ${core.formatDate(p.date, now)}`, loading: 'lazy' });
        img.addEventListener('error', () => img.replaceWith(h('span', { class: 'photo-missing', text: "Can't preview in this browser" })));
        const thumb = h('button', { type: 'button', class: 'photo-thumb', 'data-photo': String(p.id) }, img);
        thumb.addEventListener('click', () => openPhotoViewer(p));
        grid.append(thumb);
      }
      stack.append(h('section', { class: 'card' }, h('h3', { class: 'section-title', text: dateLabel }), grid));
    }
    return { root: stack };
  }

  function openPhotoViewer(photo) {
    const now = today();
    const dateText = core.formatDate(photo.date, now);
    const labelId = uid('photo');
    const src = store.photoSrc(photo);
    const closeBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Close' });
    const deleteBtn = h('button', { type: 'button', class: 'btn btn-danger-outline', text: 'Delete…' });
    const content = h(
      'div',
      { class: 'viewer' },
      h('h2', { id: labelId, class: 'viewer-title', text: `Progress photo, ${dateText}` }),
      h('img', { src: src.url, alt: `Progress photo, ${dateText}`, class: 'viewer-img' }),
      h('div', { class: 'viewer-bar' }, deleteBtn, closeBtn)
    );
    const close = openDialog({ labelId, content, className: 'dialog-viewer', initialFocus: closeBtn, onClose: src.release });
    closeBtn.addEventListener('click', () => close());
    deleteBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: `Delete this photo from ${dateText}?`,
        message: "It will be removed from Kenna for good. This can't be undone.",
        confirmLabel: 'Delete photo',
        danger: true,
      });
      if (!ok) return;
      try {
        await store.deletePhoto(photo.id);
        close();
        toast('Photo deleted');
        render();
      } catch (err) {
        toast(`Photo not deleted. ${err.message}`, { tone: 'error' });
      }
    });
  }

  // ------------------------------------------------------------ Settings

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function formatBytes(n) {
    if (n < 1024 * 1024) return `${core.formatNumber(Math.max(1, Math.round(n / 1024)))} KB`;
    return `${core.formatNumber(n / (1024 * 1024), 1)} MB`;
  }

  function plural(n, word) {
    return `${core.formatNumber(n)} ${word}${n === 1 ? '' : 's'}`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: filename, class: 'visually-hidden' });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function buildBackupSection() {
    const progress = h('progress', { class: 'progress', max: '1', value: '0', hidden: true });
    const message = h('p', { class: 'field-status', role: 'status' });
    const exportBtn = h('button', { type: 'button', class: 'btn btn-primary', text: 'Export Backup' });
    const fileInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', id: uid('import') });
    const importLabel = h('label', { class: 'btn btn-secondary file-btn', for: fileInput.id, text: 'Import Backup' });
    const lastLine = h('p', { class: 'card-sub' });

    function refreshLast() {
      const last = prefs.get('lastBackupAt', null);
      lastLine.textContent = last ? `Last backup file saved ${core.formatRelativeDate(core.localDateStr(new Date(last)), today())}.` : 'No backup file saved from this device yet.';
    }
    refreshLast();

    function setMessage(tone, text) {
      message.className = `field-status${tone ? ` is-${tone}` : ''}`;
      message.setAttribute('role', tone === 'error' ? 'alert' : 'status');
      message.textContent = text;
    }
    function setProgress(done, total) {
      progress.hidden = total === 0;
      progress.max = Math.max(1, total);
      progress.value = done;
    }
    function busy(on) {
      exportBtn.disabled = on;
      fileInput.disabled = on;
      importLabel.classList.toggle('is-disabled', on);
    }

    exportBtn.addEventListener('click', async () => {
      busy(true);
      try {
        setMessage('pending', 'Preparing backup…');
        const entries = await store.loadEntries();
        const days = {};
        for (const e of visibleEntries(entries)) days[e.date] = e;
        const photos = await store.listPhotos();
        const encoded = [];
        setProgress(0, photos.length);
        for (let i = 0; i < photos.length; i += 1) {
          setMessage('pending', `Adding photos: ${i + 1} of ${photos.length}…`);
          const blob = await store.getPhotoBlob(photos[i]);
          encoded.push({ date: photos[i].date, createdAt: photos[i].createdAt, type: blob.type || photos[i].type, data: await blobToBase64(blob) });
          setProgress(i + 1, photos.length);
        }
        const file = new Blob(core.serializeBackup(days, encoded, new Date().toISOString()), { type: 'application/json' });
        downloadBlob(file, `kenna-backup-${today()}.json`);
        prefs.set('lastBackupAt', new Date().toISOString());
        refreshLast();
        setMessage('saved', `Backup file saved: ${plural(Object.keys(days).length, 'day')} and ${plural(photos.length, 'photo')} (${formatBytes(file.size)}). Keep it somewhere other than this phone, like Files, iCloud Drive or email.`);
      } catch (err) {
        setMessage('error', `Backup not saved. ${err.message}`);
      } finally {
        setProgress(0, 0);
        busy(false);
      }
    });

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      busy(true);
      try {
        setMessage('pending', 'Checking backup file…');
        const parsed = core.parseBackup(await file.text());
        if (!parsed.ok) {
          setMessage('error', parsed.error);
          return;
        }
        setMessage(null, '');
        const ok = await confirmDialog({
          title: 'Restore from this backup?',
          message: `It has ${plural(parsed.dayCount, 'day')} and ${plural(parsed.photoCount, 'photo')}. Days in the file replace the same days here; other days and photos stay as they are.`,
          confirmLabel: 'Restore',
        });
        if (!ok) return;
        setMessage('pending', 'Restoring days…');
        const restored = await store.importEntries(parsed.entries);
        let photoResult = { added: 0, skipped: 0 };
        if (parsed.photos.length) {
          setProgress(0, parsed.photos.length);
          photoResult = await store.importPhotos(parsed.photos, (done, total) => {
            setMessage('pending', `Restoring photos: ${done} of ${total}…`);
            setProgress(done, total);
          });
        }
        const skippedNote = photoResult.skipped ? ` ${plural(photoResult.skipped, 'photo')} ${photoResult.skipped === 1 ? 'was' : 'were'} already here.` : '';
        const summary = `Restored ${plural(restored, 'day')} and ${plural(photoResult.added, 'photo')}.${skippedNote}`;
        setMessage('saved', summary);
      } catch (err) {
        setMessage('error', `Import stopped. ${err.message}`);
      } finally {
        setProgress(0, 0);
        busy(false);
      }
    });

    return h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title', text: 'Backup' }),
      h('p', {
        class: 'card-sub',
        text: 'A backup file holds every day (weight and meal calories) and every progress photo with its date. Importing one restores them; importing the same file twice never duplicates anything.',
      }),
      lastLine,
      exportBtn,
      fileInput,
      importLabel,
      progress,
      message
    );
  }

  async function buildSettings() {
    const pref = prefs.get('theme', 'system');
    const name = uid('theme');
    const options = [
      { value: 'system', label: 'System' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ];
    const themeGroup = h(
      'fieldset',
      { class: 'segmented segmented-wide' },
      h('legend', { class: 'visually-hidden', text: 'Theme' }),
      options.map((o) => {
        const radio = h('input', { type: 'radio', name, value: o.value, id: `${name}-${o.value}`, class: 'visually-hidden', checked: o.value === pref });
        radio.addEventListener('change', () => {
          prefs.set('theme', o.value);
          applyTheme(o.value);
        });
        return [radio, h('label', { for: radio.id, class: 'segment', text: o.label })];
      })
    );
    const appearance = h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title', text: 'Settings' }),
      h('h3', { class: 'section-title', text: 'Appearance' }),
      h('p', { class: 'card-sub', text: 'System follows your phone’s light or dark setting.' }),
      themeGroup
    );

    const storageCard = h('section', { class: 'card' }, h('h3', { class: 'section-title', text: 'Where your data lives' }));
    if (BACKEND === 'server') {
      storageCard.append(h('p', { class: 'card-sub', text: 'Days and photos are saved by the Kenna server in its data folder, on the computer running it.' }));
    } else {
      storageCard.append(h('p', { class: 'card-sub', text: 'Days and photos are saved only in this browser on this device. Nothing is uploaded anywhere.' }));
      const persisted = await store.persistenceStatus();
      if (persisted === true) {
        storageCard.append(h('p', { class: 'card-sub', text: 'This browser has agreed to keep Kenna’s data even when the device is low on space.' }));
      } else if (persisted === false) {
        storageCard.append(
          h('p', {
            class: 'card-sub',
            text: 'This browser may clear Kenna’s data if the device runs low on space. Adding Kenna to your Home Screen and saving backup files regularly keeps it safe.',
          })
        );
      }
    }

    return { root: h('div', { class: 'screen-stack' }, appearance, buildBackupSection(), storageCard) };
  }

  const SCREEN_BUILDERS = {
    today: buildToday,
    log: buildLog,
    history: buildHistory,
    compare: buildCompare,
    photos: buildPhotos,
    settings: buildSettings,
  };

  // ------------------------------------------------------------ start

  function renderBlocked() {
    main.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title', text: 'Storage is blocked here' }),
        h('p', { class: 'card-sub', text: "This browser or tab won't let Kenna save anything, so nothing you logged would actually be kept." }),
        h('p', {
          class: 'card-sub',
          text: "This usually means Private Browsing, or a link opened inside another app's built-in browser (Messages, Instagram, TikTok and so on).",
        }),
        h('p', { class: 'card-sub', text: 'Fix: open this page in Safari itself, tap Share, then Add to Home Screen, and open Kenna from that icon from now on.' })
      )
    );
  }

  async function start() {
    applyTheme(prefs.get('theme', 'system'));
    document.getElementById('storageNote').textContent =
      BACKEND === 'server' ? 'Data is saved on the Kenna server.' : 'Data is saved only in this browser, on this device.';
    const status = await store.init();
    if (!status.ok) {
      renderBlocked();
      return;
    }
    store.requestPersistence();
    store.onExternalChange(() => {
      if (currentView && currentView.refreshFromStorage) currentView.refreshFromStorage().catch(() => {});
      else if (route.screen === 'history' || route.screen === 'compare') render();
    });
    window.addEventListener('hashchange', onHashChange);
    visited.push(currentHash());
    await render();

    if (BACKEND === 'local' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {
        // The app still works online without offline caching.
      });
    }
  }

  start();
})();
