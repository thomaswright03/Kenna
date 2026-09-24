# Kenna — Private Calorie and Weight Tracker

A lightweight calorie and weight tracker. No cloud account, no sign-up: your
data never leaves your device.

## What it does

- **Today** shows the day's date, your weight and the calories logged so far,
  one row per meal, and Calories and Weight charts (last 30 days, 90 days or
  all time). Pick another date, or tap a day in History, to view or fix a past
  day; **Back to today** returns to the current day.
- **Log Meal** takes one total-calorie number per meal or snack (Breakfast,
  Snack 1, Lunch, Snack 2, Dinner, Snack 3) instead of itemised foods. Each
  value saves as soon as you leave the box or tap another meal; **Enter** moves
  to the next meal you haven't logged; **Done** returns to the day you were
  logging and confirms what was saved. Removing a meal from the Today screen can be
  undone for a few seconds.
- **History** lists every logged day with its total calories and weight. Tap a
  day to open it.
- **Compare** puts today's weight, total calories and each meal next to
  yesterday and your all-time average, followed by 7-day rolling averages of
  calories and weight.
- **Photos** stores progress pictures, filed under the day you add them.
  Deleting one asks for confirmation first.
- **Settings** (gear icon) has the light/dark theme (or follow the system),
  backup export and import, and where your data is stored.

How the numbers work:

- A day counts toward calorie statistics (averages, the "yesterday"
  comparison, charts) only if at least one meal was logged. A day with only a
  weight shows "No meals logged", never "0 cal", and is a gap in the calorie
  chart. Weight statistics use every day that has a weight.
- All-time averages leave out today, so Compare shows "today vs a typical day".
- A meal's average uses only the days that meal was logged.
- Calories must be whole numbers from 0 to 10,000 per meal; weight must be
  between 50 and 1,000 lbs. Anything else shows a message and isn't saved.
- The Today screen follows the calendar: if the app is left open (or resumed
  from the background) past midnight it moves to the new day, and anything
  logged after midnight goes to the new day. A past day you opened on purpose
  stays open.
- Charts use a real time axis: days you didn't log are gaps (a dashed line
  bridges them), and each chart ends at today.

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
on the device.

### Where your data lives, and backups

Days are stored in the browser's `localStorage` and photos in its IndexedDB,
on that device only. On first launch the app asks the browser to keep this
data even when the device runs low on space (Settings shows the answer
where the browser supports asking). Every save also keeps one previous copy of your days, and if
the stored data is ever found damaged the app restores that copy and tells you.

That still doesn't protect against clearing Safari's website data, switching
phones or losing the phone, so save a backup file regularly:

- **Settings → Export Backup** downloads one `.json` file containing every
  day (weight and each meal's calories) and every progress photo with the date
  it was filed under. Keep it somewhere other than the phone (Files, iCloud
  Drive, email). Progress is shown while photos are added.
- **Settings → Import Backup** checks the whole file first. If anything in it
  is invalid, nothing is imported and you're told what's wrong. Otherwise days
  in the file replace the same days on the device (other days are kept), and
  photos are added unless they're already there, so importing the same file
  twice never creates duplicates. Backups made by older versions (days only)
  still import.

The file does not contain settings such as the theme or chart range.

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
address in a browser on the same device.

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

## Development

```
docs/            the app (also what GitHub Pages serves)
  core.js        data rules shared by the app, the server and the tests
  store-local.js browser storage (localStorage + IndexedDB)
  store-server.js server storage (HTTP API)
  backend.js     picks the storage; server.js serves its own version
  app.js         the user interface
  sw.js          offline cache
server.js        the server version and its API
scripts/serve-docs.js  serves docs/ locally exactly as Pages would
test/unit/       Node tests: data rules, browser storage, server API
test/e2e/        Playwright tests, run against both versions
```

The `public/` folder is left over from when the server version had its own
copy of the app; `server.js` no longer uses it.

Run the phone app locally (no server storage involved):

```bash
npm install
npm run serve:docs          # http://localhost:8080 (set PORT to change)
```

Tests:

```bash
npx playwright install chromium   # once
npm test                          # lint, unit/API tests, then browser tests
```

`npm run test:unit` and `npm run test:e2e` run the parts separately. GitHub
Actions (`.github/workflows/test.yml`) runs the same checks on every push and
pull request. To block merging when they fail, turn on branch protection for
the published branch in **Settings → Branches** and mark the **Tests / test**
check as required.

## Deploying the phone app (GitHub Pages)

Pages is configured in the repository's **Settings → Pages**: *Source:
Deploy from a branch*, with the published branch and the **`/docs`** folder.
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
