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
- [REQUIREMENTS.md](REQUIREMENTS.md): every rule's value and reason, for the owner to confirm

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
| Far from your usual | asked about before saving (a meal over 3× its usual, a weight over 5 lbs from the day before) |
| Days that can be logged | today and earlier |
| Averages | leave out today; calories count only days with meals |
| Units and language | pounds, US English only |

The full rules: [How the numbers work](REFERENCE.md#how-the-numbers-work).
Every threshold and limit, with why it was chosen and whether the owner
has agreed it yet, is in [REQUIREMENTS.md](REQUIREMENTS.md); a pull request
that changes one updates it too (a unit test checks it matches the code).

## Your data and backups

- Days are kept in the browser's `localStorage` and photos in IndexedDB,
  on the phone only. Nothing is sent anywhere.
- **Settings → Export Backup** saves one `.json` file with every day and
  photo; **Import Backup** restores it (and can be undone). Today always
  shows how old the last saved backup is, with **Back up now**. Once a few
  days are logged it asks for a backup every 3 days (daily or weekly if
  chosen in Settings), and as soon as a new photo isn't in a saved backup.
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
  store-local.js browser storage, put together from the modules in store/
                 (days in localStorage, photos in IndexedDB, damaged
                 copies, device persistence)
  app.js         the user interface's entry point (an ES module)
  ui/            the interface, one module per screen plus shared parts
                 (routing, rendering, charts, dialogs and messages, backup,
                 photo viewer and comparison)
  data.js        sets the globals the interface reads (core.js,
                 store-local.js and backup-file.js)
  build/         what the page loads: the scripts above, minified into
                 data.js (data.js and all it requires) and app.js
                 (app.js and ui/), with source maps; made by npm run build
  404.html       the "Page not found" page
  sw.js          offline cache
scripts/build.js       builds docs/build/ (esbuild)
scripts/serve-docs.js  serves docs/ locally as Pages would (compressed, with
                       404.html for unknown addresses)
scripts/coverage.js    measures what the unit and browser tests run
scripts/make-icons.js  draws the app icon (a scale) in every size, from
                       the drawing in it (then run npm run build)
scripts/check-release-record.js  checks the iPhone checklist has a row for
                       what a pull request merges (CI, on pull requests
                       into the published branch)
test/unit/       Node tests: data rules, browser storage, backup files, build,
                 and days passing both ways between this version and the
                 published one (its built data.js, kept in published/)
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
   **Tests / webkit**) are green on the pull request; the published
   branch's ruleset (see [Who looks after it](#who-looks-after-it)) won't
   let GitHub merge it otherwise. Go through the "Before merging" part
   of [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md) on an iPhone, on the
   pull request's last commit (install the live version to the Home Screen
   and upgrade it to this one with its days intact, log a meal, add a
   photo, export with Save to Files and import that file back), and add its
   row to the checklist's Record table, every step's result by number, in a
   commit that changes only that file. A third check on pull requests into
   the published branch, **Tests / release-record**
   (`scripts/check-release-record.js`), fails until that row names a commit
   on the branch after which only the checklist changed. The pull request
   template asks for all of this, with links to the two test runs for the
   head commit. Then merge the pull request into the published branch.
3. Pages redeploys within a minute or two (see the repository's Actions tab).
   Phones load the new version the next time the app is opened online.
   Finish the checklist's "After Pages deploys" part on the live app.

Rolling back: `git revert` the commit(s) that caused the problem on a new
branch, merge that through a pull request once both checks pass, and Pages redeploys the previous files. User data is never
part of a deploy, so a rollback doesn't touch anyone's logged days or photos;
the app reads every older storage format, and an older version still finds
every day (every save writes all the days in the format every version reads).

## Who looks after it

The repository, its **Settings → Pages** (what is published) and
**Settings → Rules** (the ruleset that protects the published branch) belong to the GitHub account
**thomaswright03**, the owner. Anyone else who is to deploy or roll back
needs write access, which the owner gives under **Settings →
Collaborators**; without it, open a pull request and ask the owner to
merge it.

The published branch is protected by the ruleset "Protect live app",
turned on 2026-09-24: changes arrive only through a pull request, which
can be merged only once both checks (**Tests / test** and **Tests /
webkit**) pass; force pushes and deleting the branch are blocked; and
nobody, the owner included, is on its bypass list. **Tests /
release-record** is not among its required checks unless the owner adds
it there (**Settings → Rules → Rulesets → Protect live app → Require
status checks to pass**); until then it shows on the pull request but
doesn't block the merge. To confirm it is
still so, open **Settings → Rules → Rulesets → Protect live app**, or
look for the two required checks on any open pull request into the
published branch.

### If the live app is broken

1. On a computer with git and write access, get the published branch:
   `git clone https://github.com/thomaswright03/kenna.git && cd kenna &&
   git checkout claude/phone-calorie-tracker-gbxsn6`.
2. Find the change that broke it: `git log --oneline -10` lists the latest
   commits, newest first (the repository's Actions tab shows which one
   Pages deployed last).
3. Undo it on a new branch: `git checkout -b revert-broken-change`, then
   `git revert --no-edit <commit>` (for a merge commit,
   `git revert --no-edit -m 1 <commit>`), then
   `git push -u origin revert-broken-change`.
4. Open a pull request from that branch into
   `claude/phone-calorie-tracker-gbxsn6` and merge it once **Tests / test**
   and **Tests / webkit** are green (the ruleset doesn't allow pushing to
   the published branch directly).
5. Wait for the "pages build and deployment" run in the Actions tab to
   finish (a minute or two), then open the app online: it loads the
   previous version. Nobody's logged days or photos are affected.
6. Tell the owner which commit was reverted, so the fix can be made on a
   branch and released again as described above.
