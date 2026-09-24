# Kenna — Private Calorie and Weight Tracker

[![Tests on the published branch](https://github.com/thomaswright03/kenna/actions/workflows/test.yml/badge.svg?branch=claude%2Fphone-calorie-tracker-gbxsn6)](https://github.com/thomaswright03/kenna/actions/workflows/test.yml?query=branch%3Aclaude%2Fphone-calorie-tracker-gbxsn6)

The badge shows the latest test run (Chromium and WebKit) on the published
branch, the one GitHub Pages serves.

A lightweight calorie and weight tracker. No cloud account, no sign-up: your
data never leaves your device.

## What it does

- **Today** shows the day's date, your weight and the calories logged so far,
  one row per meal, and Calories and Weight charts (last 30 days, 90 days or
  all time). Tap anywhere on a meal's row to open Log Meal at that meal.
  Emptying the weight box clears the day's weight, with **Undo** under the
  box to put it back. Pick another day in **Day to view or edit**, or tap a day in
  History, to view or fix a past day; **Back to today** returns to the current day.
- **Log Meal** takes one total-calorie number per meal or snack (Breakfast,
  Snack 1, Lunch, Snack 2, Dinner, Snack 3) instead of itemised foods. Each
  value saves as soon as you leave the box or tap another meal, and also if
  you switch to another app, lock the phone or close the page with a number
  still in the box (a number that isn't valid isn't saved; the next visit
  puts it back in its box and says why). The day total updates as you type,
  marked "not saved yet" until the save is done; **Enter** moves
  to the next meal you haven't logged; **Save and close** saves what's in the box, returns to the day you
  were logging and confirms what was saved. Each saved meal's button shows
  a ✓ and its calories. On the Today screen **Log Meal** is the main way
  in; tapping a meal's row (its name, calories or **Add**/**Edit**) opens
  Log Meal at that meal. A meal removed on the Today screen
  keeps an **Undo** button in its row until you leave that screen.
- **History** lists every logged day with its total calories and weight,
  grouped by month under headings with each month's average calories
  (days with meals, not counting today) and weight. The most recent
  months are shown first; **Show earlier months** adds more, and **Go to
  month** jumps to any month. Tap a day to open it; going back (Back, the
  back gesture) returns to the same place in History, with the same months
  shown, while opening History from the tab bar starts at the top.
- **Compare** answers "how am I doing today?" first, in two sentences:
  calories so far against your average for the same meals ("So far today:
  100 cal less than your average breakfast and lunch") and today's weight
  against your average weight and yesterday ("0.6 lbs below your
  average"), with the numbers behind each. Plain bars show today's
  calories so far, your usual for those meals, the average day (when it's
  different) and yesterday side by side, from zero. Each meal's today, yesterday and
  average are one tap further down (**Each meal…**). Below that are
  7-day rolling averages of calories and weight. The 7-day calorie average
  leaves today out until the day is over (on the Today screen's Calories
  chart today's running total is a lone hollow marker labelled "so far",
  never joined to the line).
- **Photos** stores progress pictures, filed under the day they were taken:
  pick the day before adding one (it starts at today, and future days aren't
  allowed), and change it later from the photo viewer. The viewer steps
  through the photos oldest first with **Previous** and **Next**, a swipe or
  the arrow keys. **Compare photos** (on the Photos screen, or **Compare**
  in the viewer) shows two photos side by side, older on the left, with
  each one's date and that day's weight and how far apart they are.
  Deleting a photo asks for confirmation first. A photo in a format the
  browser can't draw (HEIC anywhere but Safari, for example after
  restoring a backup on a laptop) is still kept and backed up as it is;
  adding one says it can't be previewed in this browser, and the grid, the
  viewer and the comparison say "Can't preview in this browser" in its
  place.
- **Settings** (gear icon) has the light/dark theme (or follow the system),
  backup export and import, and where your data is stored.

On a screen wider than about 900 pixels (a laptop or tablet), the tabs
move up beside the Kenna name and Settings, and Today, Compare, History
and Settings use two columns: the day's entry or the answers on the left,
charts and the rest on the right. History's right column lists every
month's average calories and weight (**Month by month**, in place of Go
to month); tapping a month goes to it.

How the numbers work:

- A day counts toward calorie statistics (averages, the "yesterday"
  comparison, charts) only if at least one meal was logged. A day with only a
  weight shows "No meals logged", never "0 cal", and is a gap in the calorie
  chart. Weight statistics use every day that has a weight.
- All-time averages leave out today, so Compare shows "today vs a typical day".
- Compare's calorie sentence compares like with like: the meals logged
  today against the sum of those same meals' averages (breakfast so far
  against your average breakfast, not against a whole day). A meal logged
  today that was never logged before has no average; it's left out of the
  comparison and named under it. The average whole day is still shown
  beside it.
- A meal's average uses only the days that meal was logged.
- Calories must be whole numbers from 0 to 10,000 per meal ("1,200" is read
  as 1200); weight must be between 50 and 1,000 lbs, with at most two decimal
  places. Anything else isn't saved and shows a message naming what's wrong
  (a decimal, a minus sign, a stray letter, a decimal comma, too many decimal
  places, or out of range). A weight ending in a decimal point ("165.") is
  read as the whole number. The same rules, with the same messages, apply
  to a value sent to the server's API, which refuses it. In a backup file
  the day holding such a value is left out of the restore, and the restore
  names it (see Import Backup below). Meals saved by the first version as
  lists of foods still import as their total. The first version saved
  weights exactly as typed; a weight with more than two decimals from then
  is shown, written into backups and read from backups rounded to two.
- A day after today can't be logged, whether picked, typed into the address
  bar or sent to the server's API (the server allows one day ahead of its
  own clock, for a phone in a time zone ahead of it). The same goes for filing a photo, on
  the phone and through the server's API. A backup's days and photos dated
  after today are left out on import, and the import says how many. An
  address that doesn't lead anywhere opens Today and is replaced by Today's
  address; one with a date that doesn't exist (Feb 30) does the same and
  says "That date doesn't exist, so Today is shown."
- A day more than a year ago that is also more than a month before the
  first day you logged is probably a mistyped year (2002 for 2026), so
  opening it, by the day picker or by address, asks "Log a day in 2002?"
  and nothing can be logged there until you confirm. Backups can still
  restore days of any age.
- The Today screen follows the calendar: if the app is left open (or resumed
  from the background) past midnight it moves to the new day, and anything
  logged after midnight goes to the new day. A past day you opened on purpose
  stays open.
- Charts use a real time axis: days you didn't log are gaps (a dashed line
  bridges them), and each chart ends at today. Over more than 120 days (the
  All range) a chart plots weekly averages instead of single days, and
  over more than about three years monthly averages, which keeps it to
  about 160 points or fewer for up to 13 years of data; the chart's subtitle says which ("Weekly average
  weight"), and a point's tooltip names its week or month. When a chart spans more
  than one calendar year, every date on its axis shows the year. The
  calorie axis never goes below 0. The value axis always covers at least
  2 lbs, or 200 cal (a fifth of the value, when that's more), so a single
  day or a tiny change doesn't look like a dramatic one.
- A weight is shown as it was entered, to up to two decimals (165.25);
  averages are shown to one.
- Weight is in pounds (lbs) and dates and numbers are written the US English
  way ("Thu, Sep 24", "1,200 cal"), whatever the device's language. Pounds and
  US English only are a deliberate limit of scope: there is no kilogram
  setting and no translation.

## Using it on your phone (recommended — `docs/`)

The `docs/` folder is a self-contained, installable web app: no App Store, no
server, no account. It's live at `https://thomaswright03.github.io/Kenna/`.
Anyone with that link can install it on their own phone; each person's data
stays on their own device.

1. Open that URL in Safari (iPhone) or Chrome (Android).
2. iPhone: tap the Share icon → **Add to Home Screen**. Android: tap the
   **⋮** menu → **Add to Home screen** / **Install app**.
3. It opens full-screen with its own icon, like any other app.

The first visit downloads a handful of files (the app's scripts are built
into two minified files, see Development), showing "Loading Kenna…" until
they arrive. With Chromium's "Slow 3G" network emulation Today appears in
under 6 seconds (a browser test checks this).
It works **offline** once opened at least once: the app's files are cached
on the device. When online it loads the latest version; on a weak signal
that hasn't answered within 3 seconds it opens from the cached copy instead,
and the newer files, once they arrive, are used from the next launch.

### Where your data lives, and backups

Days are stored in the browser's `localStorage` and photos in its IndexedDB,
on that device only. On first launch the app asks the browser to keep this
data even when the device runs low on space (Settings shows the answer
where the browser supports asking). Every save also keeps one previous copy of your days, and if
the stored data is ever found damaged the app restores that copy and tells you.
The damaged data itself is kept aside (the two most recent damaged copies,
never more), and Settings then shows a card to **Download damaged data**
as a file or **Delete damaged data**.

If the browser refuses a save (storage full, or photo storage that won't
open), the app says what failed, that what's already saved is safe, and
what to do next: close and reopen Kenna, or export a backup and delete old
photos or free up space on the phone. The browser's own error text is never
shown.

On iPhone and iPad, Safari may delete a website's data when it hasn't
been used for about a week, unless the site is on the Home Screen. So when
Kenna runs in a Safari tab there (not opened from the Home Screen), Today
shows a card saying so, with the steps one tap away (**How to add it**:
Share → Add to Home Screen → open Kenna from that icon). If anything is
logged it also says to save a backup first, because the Home Screen app
starts with its own, empty storage. **Not now** hides the card for a
week; it never appears when Kenna is opened from the Home Screen, and
Settings explains the same risk.

That still doesn't protect against clearing Safari's website data, switching
phones or losing the phone, so save a backup file regularly. Once anything is
logged, the Today screen reminds you when no backup has been saved from this
device yet, or when the last one is more than a week old; **Back up now**
makes one straight away, and **Not now** hides the reminder for three days.
Today shows at most one of these cards above the day, so the Weight box
stays in view: the Home Screen card first (it already says to back up),
then the backup reminder once that card is hidden or doesn't apply.

- **Settings → Export Backup** makes one `.json` file containing every day
  (weight and each meal's calories) and every progress photo with the date
  it was filed under, with progress shown while photos are added. Keep it
  somewhere other than the phone (Files, iCloud Drive, email). Where the
  browser can share files (iPhone, Android), **Save or share…** opens the
  share sheet (Save to Files, iCloud Drive, Mail); **Download instead** is
  there too. Elsewhere the file is downloaded, and **I've saved it** confirms
  it arrived.
- A backup only counts as saved, for the reminder and for the "Last backup
  file saved" line in Settings and History, once a share has completed or
  you've tapped **I've saved it**; cancelling the share sheet or ignoring a
  download leaves the reminder in place. (Versions before this recorded
  the time a download started; that time is still used by the reminder, and
  Settings says it wasn't confirmed.)
- **Settings → Import Backup** checks the whole file first, then asks
  before changing anything: how many days and photos the file has, how
  many of your days it will replace with the file's version, and how many
  it adds. If some days or photos in the file can't be restored (a value
  outside the rules above, a date that doesn't exist), the question lists
  them and the button reads **Restore the rest**; the result lists them
  again. A file with nothing that can be restored isn't imported, and the
  message says what's wrong. Days in the file replace the same days on the
  device (other days are kept); a day already on the device exactly as in
  the file is left alone, and the result counts it as already here rather
  than restored; the days about to be replaced are saved
  first, so **Undo restore**, shown with the result, puts them back as they
  were and removes the photos the restore added. Photos are added unless they're already there (a photo is recognised by
  the time it was first added, so moving it to another day doesn't make it
  look new), so importing the same file twice never creates duplicates. Backups made by older versions (days only)
  still import.

The file does not contain settings such as the theme or chart range.

Photos are read one at a time, never all together. Listing them (the
Photos screen, a backup, finding which photos an import already has) reads
only each photo's day and time, kept in a small index next to the photos.
The Photos grid shows small previews (360 pixels, a few tens of KB), made
when a photo is added, or the first time an older photo is shown, and only
for the photos near the screen; the full image is read when a photo is
opened or backed up.

Backup files are written and read a photo at a time too (reading goes
through the file in 1 MB pieces). A year of daily photos makes a file of
about 190 MB. The automated tests store 365 photos of about 400 KB (the
way earlier versions stored them, with no index or previews), then open
Photos, export them and restore them into an empty app, checking in
Chromium that the memory of the page's own process never grows by more
than a third of the library's size (with garbage collected as it goes, as a
phone short of memory would). The finished backup file itself is held by
the browser until it is saved. Import checks the whole file first, then
adds the days and the photos; if it is interrupted part-way, importing the
same file again adds only the photos that are still missing.

## Alternative: run your own server (`server.js`)

A Node/Express version stores everything in files on the computer running it
(`data/entries.json`, `data/photos.json` and `data/photos/`). It serves the
same app as `docs/`, switched to save through the server's API instead of the
browser, so both versions always behave the same.

Requires Node.js 20 or newer. On Android, [Termux](https://termux.dev) from
F-Droid works (`pkg install nodejs`). From this project folder:

```bash
npm install --omit=dev
npm start
```

You'll see `Kenna calorie tracker running at http://localhost:3000`. Open that
address in a browser on the same device. When it accepts connections from
other devices (the default `HOST`), the next line lists this computer's
network addresses, such as `http://192.168.1.23:3000`, to open on a phone
on the same Wi-Fi.

Environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `HOST` | `0.0.0.0` | Address to bind. `0.0.0.0` also accepts connections from other devices on your network; use `127.0.0.1` to allow only this device. There is no login, so only expose it on a network you trust. |
| `KENNA_DATA_DIR` | `./data` | Folder for the data files and photos |

For example: `PORT=8080 HOST=127.0.0.1 KENNA_DATA_DIR=~/kenna-data npm start`.

Every write keeps the previous file as a `.bak` copy and replaces the file
atomically. If a data file is unreadable, the server restores it from the
`.bak` copy (keeping the damaged file as `*.damaged-<time>`); if there is no
usable copy it leaves the file untouched and the app shows an error rather
than overwriting it. Days in the file that can't be read are skipped, not
fatal. Backup export and import work the same way as on the phone.

While a screen is loading from the server the previous screen is dimmed and
can't be used, with a "Loading…" indicator if it takes more than a moment.
If the server doesn't answer within 10 seconds (60 for a photo), the app
says it isn't responding and offers **Try again** (or **Retry** next to a
value that wasn't saved; the typed value stays in its box). Unknown
addresses on the server, including a photo that no longer exists opened
in a browser, show a "Page not found" page with a link to the app (the
same `docs/404.html` that GitHub Pages shows for an unknown address). The
server sends the app's files and its answers compressed when the browser
accepts it.

Opened at `http://localhost:3000` (on the computer running the server),
the server version keeps a copy of the app's own files, never your data,
so opening or reloading it while the server is stopped shows Kenna's
"Couldn't reach the Kenna server" message with **Try again**. Browsers
only allow that on `localhost` or `https`: opened by a network address
(`http://192.168.1.23:3000` on a phone), the page doesn't open at all
until the server is running, and the browser shows its own error page.

## Development

```
docs/            the app (also what GitHub Pages serves)
  core.js        data rules shared by the app, the server and the tests,
                 put together from the modules in core/ (dates, numbers,
                 entries, averages, input rules, backup format, charts,
                 photos)
  backup-file.js writes and reads backup files a piece at a time
  store-local.js browser storage (localStorage + IndexedDB)
  store-server.js server storage (HTTP API)
  backend.js     picks the storage; server.js serves its own version
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
server.js        the server version and its API
scripts/build.js       builds docs/build/ (esbuild)
scripts/serve-docs.js  serves docs/ locally as Pages would (compressed, with
                       404.html for unknown addresses)
scripts/coverage.js    measures what the unit and browser tests run
test/unit/       Node tests: data rules, browser storage, server API
test/e2e/        Playwright tests, run against both versions
```

The JavaScript is type-checked with TypeScript from JSDoc comments. `npm
run typecheck` runs it; `docs/globals.d.ts` declares what the classic
scripts put on `window`. ESLint (`npm run lint`) also keeps every function
in `docs/app.js` and `docs/ui/` to 80 lines of code or fewer.

The page loads `docs/build/data.js` and `docs/build/app.js` rather than the
thirty-odd source files, so a first visit on a slow connection waits for a
few downloads instead of dozens. After changing any file in `docs/`, run
`npm run build`, or keep `npm run build:watch` running, and commit the
rebuilt files and `docs/sw.js` with the change: Pages serves `docs/` as it
is. The build also writes the service worker's cache name, a hash of the
files it keeps for offline use. A unit test fails when the built files
don't match the sources, or the cache name doesn't match the files. The build minifies without changing the language level the
sources are written in (ES2022), and the source maps point browser
developer tools at the original files.

Run the phone app locally (no server storage involved):

```bash
npm install
npm run build:watch         # in one terminal: rebuilds docs/build/ on every change
npm run serve:docs          # in another: http://localhost:8080 (set PORT to change)
```

Tests:

```bash
npx playwright install chromium webkit   # once
npm test                                 # lint, type check, unit/API tests, then browser tests
```

`npm run test:unit` and `npm run test:e2e` run the parts separately
(`test:e2e` rebuilds `docs/build/` first, so the browser tests run the
current sources). The
browser tests include an accessibility check (axe-core, WCAG 2 A and AA)
of every screen in both themes. The
browser tests run every scenario against both versions in Chromium with an
iPhone-sized screen (projects `phone-app` and `server-app`), and the phone
app again in WebKit, the engine behind Safari and iPhone Home Screen apps
(project `phone-app-webkit`). Locally the WebKit project is included when
WebKit is installed, and a run without it says so at the start; on CI it
always runs.

`npm run coverage` runs the unit tests and the Chromium browser tests
(both versions) and prints one coverage table for every source file:
`docs/app.js`, `docs/ui/*.js`, `docs/store-server.js`, `server.js` and the
rest. The browser tests record which parts of the built scripts ran and
the source maps turn that back into the source files. The HTML report is
written to `coverage/index.html`; `npm run coverage -- --unit` measures
the unit tests alone.

GitHub Actions (`.github/workflows/test.yml`) runs on every push and pull
request, as two checks: **Tests / test** (lint, type check, unit tests,
Chromium) and **Tests / webkit**. GitHub only blocks merging a failing
change once branch protection is on: in **Settings → Branches**, add a rule
for the published branch (see below), tick *Require status checks to pass
before merging*, and select both checks.

## Deploying the phone app (GitHub Pages)

Pages is configured in the repository's **Settings → Pages**: *Source:
Deploy from a branch*, branch **`claude/phone-calorie-tracker-gbxsn6`**,
folder **`/docs`**. That branch (also the repository's default branch) is
the published branch: whatever is in its `docs/` folder is the live app.
Other branches, such as `claude/excellence-loop`, are not published until
they are merged into it.
Pages serves the files in `docs/` as they are, which is why the built files
in `docs/build/` are committed (see Development).

Releasing a change:

1. Run `npm run build` and commit what it changes. It rebuilds the
   scripts and names the service worker's cache (`CACHE_NAME` in
   `docs/sw.js`) after a hash of every file it pre-caches, so any change
   to one of them gives phones a new cache to pre-cache together. A unit
   test fails if either is out of date.
2. Make sure `npm test` passes, and go through the "Before merging" part
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
