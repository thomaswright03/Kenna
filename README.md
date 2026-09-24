# Kenna — Private Calorie and Weight Tracker

[![Tests on the published branch](https://github.com/thomaswright03/kenna/actions/workflows/test.yml/badge.svg?branch=claude%2Fphone-calorie-tracker-gbxsn6)](https://github.com/thomaswright03/kenna/actions/workflows/test.yml?query=branch%3Aclaude%2Fphone-calorie-tracker-gbxsn6)

A private calorie and weight tracker that installs on a phone from the
web. Log your weight and each meal's calories, see trends, averages and
history, and keep progress photos. No account, no sign-up: everything
stays on the device. The badge shows the latest test run (Chromium and
WebKit) on the published branch.

Kenna is the installable phone app only. An optional server version
(`server.js`) used to exist alongside it; the owner retired it, and it has
been removed along with its tests and documentation.

- [Use it on your phone](#use-it-on-your-phone)
- [Rules at a glance](#rules-at-a-glance)
- [Your data and backups](#your-data-and-backups)
- [Run it locally](#run-it-locally)
- [Test](#test)
- [Release](#release)
- [REFERENCE.md](REFERENCE.md): every screen and rule in detail

## Use it on your phone

The app is the `docs/` folder, published by GitHub Pages at
`https://thomaswright03.github.io/Kenna/`: no App Store, no server, no
account. Anyone with the link can install it; each person's data stays on
their own phone.

1. Open that address in Safari (iPhone) or Chrome (Android).
2. iPhone: Share → **Add to Home Screen**. Android: **⋮** → **Add to Home
   screen** / **Install app**.
3. Open Kenna from its new icon. It works offline once opened.

The screens: **Today** (weight, meals, charts), **Log Meal** (one calorie
total per meal), **History** (every day, by month), **Compare** (today
against your averages and yesterday), **Photos** and **Settings** (theme,
backup). [REFERENCE.md](REFERENCE.md#screens) describes each.

## Rules at a glance

| Rule | Value |
|---|---|
| Calories per meal | whole numbers, 0 to 10,000 |
| Weight | 50 to 1,000 lbs, at most two decimal places |
| Days that can be logged | today and earlier |
| Averages | leave out today; calories count only days with meals |
| Units and language | pounds, US English only |

The full rules: [How the numbers work](REFERENCE.md#how-the-numbers-work).

## Your data and backups

- Days are kept in the browser's `localStorage` and photos in IndexedDB,
  on the phone only. Nothing is sent anywhere.
- **Settings → Export Backup** saves one `.json` file with every day and
  photo; **Import Backup** restores it (and can be undone). Today always
  shows how old the last saved backup is, with **Back up now**, and asks
  for a backup once a few days are logged and none has been saved for a
  week.
- On iPhone, Safari may clear a tab's data after about a week unused, so
  Kenna asks to be added to the Home Screen when it runs in a tab.

Details: [Where your data lives, and backups](REFERENCE.md#where-your-data-lives-and-backups).

## Run it locally

Requires Node.js 20 or newer.

```bash
npm install
npm run build:watch         # in one terminal: rebuilds docs/build/ on every change
npm run serve:docs          # in another: http://localhost:8080 (set PORT to change)
```

After changing any file in `docs/`, run `npm run build` (or keep
`build:watch` running) and commit what it changes: the minified scripts
the page loads (`docs/build/`) and the offline cache name in
`docs/sw.js`. Pages serves `docs/` as it is.

```
docs/            the app (also what GitHub Pages serves)
  core.js        data rules shared by the app and the tests, put
                 together from the modules in core/ (dates, numbers,
                 entries, averages, input rules, backup format, charts,
                 photos)
  backup-file.js writes and reads backup files a piece at a time
  store-local.js browser storage (localStorage + IndexedDB)
  app.js         the user interface's entry point (an ES module)
  ui/            the interface, one module per screen plus shared parts
                 (routing, rendering, charts, dialogs and messages, backup,
                 photo viewer and comparison)
  build/         what the page loads: the scripts above, minified into
                 data.js (core.js with core/, and the other classic
                 scripts) and app.js (app.js and ui/),
                 with source maps; made by npm run build
  404.html       the "Page not found" page
  sw.js          offline cache
scripts/build.js       builds docs/build/ (esbuild)
scripts/serve-docs.js  serves docs/ locally as Pages would (compressed, with
                       404.html for unknown addresses)
scripts/coverage.js    measures what the unit and browser tests run
test/unit/       Node tests: data rules, browser storage, backup files, build
test/e2e/        Playwright tests of the app, served as Pages serves it
```

## Test

```bash
npx playwright install chromium webkit   # once
npm test                                 # lint, type check, unit/API tests, then browser tests
```

`npm run test:unit` and `npm run test:e2e` run the parts separately, and
`npm run coverage` prints coverage for every source file. The browser
tests run in Chromium and WebKit, with an accessibility check of every
screen. GitHub Actions runs **Tests / test**
and **Tests / webkit** on every push and pull request. More in
[Development details](REFERENCE.md#development-details).

## Release

The published branch is **`claude/phone-calorie-tracker-gbxsn6`**: GitHub
Pages serves its `docs/` folder. Other branches, such as
`claude/excellence-loop`, go live only once merged into it.

1. Run `npm run build` and commit what it changes. It rebuilds the
   scripts and names the service worker's cache (`CACHE_NAME` in
   `docs/sw.js`) after a hash of every file it pre-caches, so any change
   to one of them gives phones a new cache to pre-cache together. A unit
   test fails if either is out of date.
2. Make sure `npm test` passes and both GitHub checks (**Tests / test**,
   **Tests / webkit**) are green on the pull request; GitHub enforces
   that only once branch protection is on for the published branch (see
   [Development details](REFERENCE.md#development-details)). Go through the "Before merging" part
   of [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md) on an iPhone (install to
   the Home Screen, log a meal, add a photo, export with Save to Files and
   import that file back). Then merge or push to the published branch.
3. Pages redeploys within a minute or two (see the repository's Actions tab).
   Phones load the new version the next time the app is opened online.
   Finish the checklist's "After Pages deploys" part on the live app.

Rolling back: `git revert` the commit(s) that caused the problem, push to the
published branch, and Pages redeploys the previous files. User data is never
part of a deploy, so a rollback doesn't touch anyone's logged days or photos;
the app reads every older storage format.
