# Kenna — Private Calorie and Weight Tracker

[![Tests on the published branch](https://github.com/thomaswright03/kenna/actions/workflows/test.yml/badge.svg?branch=claude%2Fphone-calorie-tracker-gbxsn6)](https://github.com/thomaswright03/kenna/actions/workflows/test.yml?query=branch%3Aclaude%2Fphone-calorie-tracker-gbxsn6)

The badge shows the latest test run (Chromium and WebKit) on the published
branch, the one GitHub Pages serves.

A lightweight calorie and weight tracker. No cloud account, no sign-up: your
data never leaves your device.

## What it does

- **Today** shows the day's date, your weight and the calories logged so far,
  one row per meal, and Calories and Weight charts (last 30 days, 90 days or
  all time). Pick another day in **Day to view or edit**, or tap a day in
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
  in; each meal row also has a quieter **Add** or **Edit** link that opens
  Log Meal at that meal. A meal removed on the Today screen
  keeps an **Undo** button in its row until you leave that screen.
- **History** lists every logged day with its total calories and weight,
  grouped by month under headings with each month's average calories
  (days with meals, not counting today) and weight. The most recent
  months are shown first; **Show earlier months** adds more, and **Go to
  month** jumps to any month. Tap a day to open it.
- **Compare** answers "how am I doing today?" first, in two sentences:
  calories so far against your average day ("So far today: 500 cal more
  than your average day") and today's weight against your average weight
  and yesterday ("0.6 lbs below your average"), with the numbers behind
  each. Plain bars show today's calories so far, the average day and
  yesterday side by side, from zero. Each meal's today, yesterday and
  average are one tap further down (**Each meal…**). Below that are
  7-day rolling averages of calories and weight. The 7-day calorie average
  leaves today out until the day is over (today's running total is drawn
  hollow on the Today screen's Calories chart).
- **Photos** stores progress pictures, filed under the day they were taken:
  pick the day before adding one (it starts at today, and future days aren't
  allowed), and change it later from the photo viewer. Deleting one asks for
  confirmation first.
- **Settings** (gear icon) has the light/dark theme (or follow the system),
  backup export and import, and where your data is stored.

On a screen wider than about 900 pixels (a laptop or tablet), Today,
Compare, History and Settings use two columns: the day's entry or the
answers on the left, charts and the rest on the right.

How the numbers work:

- A day counts toward calorie statistics (averages, the "yesterday"
  comparison, charts) only if at least one meal was logged. A day with only a
  weight shows "No meals logged", never "0 cal", and is a gap in the calorie
  chart. Weight statistics use every day that has a weight.
- All-time averages leave out today, so Compare shows "today vs a typical day".
- A meal's average uses only the days that meal was logged.
- Calories must be whole numbers from 0 to 10,000 per meal ("1,200" is read
  as 1200); weight must be between 50 and 1,000 lbs, with at most two decimal
  places. Anything else isn't saved and shows a message naming what's wrong
  (a decimal, a minus sign, a stray letter, a decimal comma, too many decimal
  places, or out of range). A weight ending in a decimal point ("165.") is
  read as the whole number. The same rules, with the same messages, apply
  to a value sent to the server's API or found in a backup file: nothing
  is rounded to fit, and a backup holding such a value isn't imported (the
  message names the day and meal). Meals saved by the first version as
  lists of foods still import as their total. The first version saved
  weights exactly as typed; a weight with more than two decimals from then
  is shown, and written into backups, rounded to two.
- A day after today can't be logged, whether picked, typed into the address
  bar or sent to the server's API (the server allows one day ahead of its
  own clock, for a phone in a time zone ahead of it). The same goes for filing a photo, on
  the phone and through the server's API. A backup's days and photos dated
  after today are left out on import, and the import says how many. An
  address that doesn't lead anywhere opens Today and is replaced by Today's
  address.
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
  bridges them), and each chart ends at today. When a chart spans more
  than one calendar year, every date on its axis shows the year. The
  calorie axis never goes below 0. The value axis always covers at least
  2 lbs, or 200 cal (a fifth of the value, when that's more), so a single
  day or a tiny change doesn't look like a dramatic one.
- A weight is shown as it was entered, to up to two decimals (165.25);
  averages are shown to one.
- Weight is in pounds (lbs) and dates and numbers are written the US English
  way ("Thu, Sep 24", "1,200 cal"), whatever the device's language. There is
  no kilogram setting.

## Using it on your phone (recommended — `docs/`)

The `docs/` folder is a self-contained, installable web app: no App Store, no
server, no account. It's live at `https://thomaswright03.github.io/Kenna/`.
Anyone with that link can install it on their own phone; each person's data
stays on their own device.

1. Open that URL in Safari (iPhone) or Chrome (Android).
2. iPhone: tap the Share icon → **Add to Home Screen**. Android: tap the
   **⋮** menu → **Add to Home screen** / **Install app**.
3. It opens full-screen with its own icon, like any other app.

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

If the browser refuses a save (storage full, or photo storage that won't
open), the app says what failed, that what's already saved is safe, and
what to do next: close and reopen Kenna, or export a backup and delete old
photos or free up space on the phone. The browser's own error text is never
shown.

On iPhone and iPad, Safari may delete a website's data when it hasn't
been used for about a week, unless the site is on the Home Screen. So when
Kenna runs in a Safari tab there (not opened from the Home Screen), Today
shows a card saying so, with the steps (Share → Add to Home Screen → open
Kenna from that icon). If anything is logged it also says to save a backup
first, because the Home Screen app may start with its own, empty storage.
**Not now** hides the card for a week; it never appears when Kenna is
opened from the Home Screen, and Settings explains the same risk.

That still doesn't protect against clearing Safari's website data, switching
phones or losing the phone, so save a backup file regularly. Once anything is
logged, the Today screen reminds you when no backup has been saved from this
device yet, or when the last one is more than a week old; **Back up now**
makes one straight away, and **Not now** hides the reminder for three days.

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
- **Settings → Import Backup** checks the whole file first. If anything in it
  is invalid, nothing is imported and you're told what's wrong. Otherwise days
  in the file replace the same days on the device (other days are kept), and
  photos are added unless they're already there (a photo is recognised by
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
in a browser, show a "Page not found" page with a link to the app.

## Development

```
docs/            the app (also what GitHub Pages serves)
  core.js        data rules shared by the app, the server and the tests
  backup-file.js writes and reads backup files a piece at a time
  store-local.js browser storage (localStorage + IndexedDB)
  store-server.js server storage (HTTP API)
  backend.js     picks the storage; server.js serves its own version
  app.js         the user interface's entry point (an ES module)
  ui/            the interface, one module per screen plus shared parts
                 (routing, rendering, charts, dialogs and messages, backup)
  sw.js          offline cache
server.js        the server version and its API
scripts/serve-docs.js  serves docs/ locally exactly as Pages would
test/unit/       Node tests: data rules, browser storage, server API
test/e2e/        Playwright tests, run against both versions
```

The JavaScript is type-checked with TypeScript from JSDoc comments (no build
step: the files that ship are the files in the repository). `npm run
typecheck` runs it; `docs/globals.d.ts` declares what the classic scripts put
on `window`.

Run the phone app locally (no server storage involved):

```bash
npm install
npm run serve:docs          # http://localhost:8080 (set PORT to change)
```

Tests:

```bash
npx playwright install chromium webkit   # once
npm test                                 # lint, type check, unit/API tests, then browser tests
```

`npm run test:unit` and `npm run test:e2e` run the parts separately. The
browser tests include an accessibility check (axe-core, WCAG 2 A and AA)
of every screen in both themes. The
browser tests run every scenario against both versions in Chromium with an
iPhone-sized screen (projects `phone-app` and `server-app`), and the phone
app again in WebKit, the engine behind Safari and iPhone Home Screen apps
(project `phone-app-webkit`). Locally the WebKit project is included when
WebKit is installed; on CI it always runs.

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
Pages serves the files in `docs/` as they are; there is no build step.

Releasing a change:

1. If you changed any file listed in `APP_SHELL` in `docs/sw.js`, bump
   `CACHE_NAME` there (for example `kenna-v2` → `kenna-v3`) in the same
   change, so phones pre-cache the new set of files together.
2. Make sure `npm test` passes, then merge or push to the published branch.
3. Pages redeploys within a minute or two (see the repository's Actions tab).
   Phones load the new version the next time the app is opened online.

Rolling back: `git revert` the commit(s) that caused the problem, push to the
published branch, and Pages redeploys the previous files. User data is never
part of a deploy, so a rollback doesn't touch anyone's logged days or photos;
the app reads every older storage format.
