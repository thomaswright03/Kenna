# Kenna — Local Calorie Tracker

A lightweight calorie tracker. No cloud account, no sign-up — your data never
leaves your device.

## How it works

The home screen is a **dashboard**: today's date and weight, a running total
of calories logged so far today, and the Calories/Weight trend graphs — all
in one place.

Tapping **Log Meal** lets you enter one total-calorie number per meal or
snack — Breakfast, Snack 1, Lunch, Snack 2, Dinner, or Snack 3, in any order
— rather than itemizing individual foods and having the app add them up.
Pick a meal, type its total, move to the next one; each saves the moment you
leave the field. Tapping **Done** shows a **Confirm** screen listing what
you've logged for the day before returning to the dashboard, so nothing gets
lost by accident.

A **Photos** tab lets you upload progress pictures — each one is automatically
logged under the date you uploaded it (no separate date field to fill in) and
grouped by date in a gallery. Tap a photo to view it full-size or delete it.
Photos are saved on-device (via IndexedDB, not localStorage — photos are far
bigger than localStorage's quota allows for) or on the server, matching
whichever version you're using; either way they survive a refresh or closing
and reopening the app.

A **History** tab lists every past day with its total calories and weight.

A **Compare** tab shows today's weight, total calories, and calories for each
meal/snack, each against yesterday and against your all-time average for that
stat (averages exclude today itself, so it's "today vs your typical day," not
today diluting its own baseline). Below that, a **Trends** section plots
weight and daily calorie intake over time as line graphs across every day
you've logged.

## Using it on your phone (recommended — `docs/`)

The `docs/` folder is a self-contained, installable web app: no App Store, no
server, no account. It's already live at
`https://thomaswright03.github.io/Kenna/` — anyone with that link can install
it on their own phone independently; nobody needs to redeploy anything, and
each person's data stays local to their own device.

1. Open that URL in Safari (iPhone) or Chrome (Android).
2. iPhone: tap the Share icon → **Add to Home Screen**. Android: tap the
   **⋮** menu → **Add to Home screen** / **Install app**.
3. It now opens full-screen with its own icon, like any other app — no
   Safari/Chrome chrome around it, and no App Store listing.

It also works **offline** once opened at least once: the app itself (not
your data, which was always local) is cached on-device, so it still opens
with no signal or on airplane mode.

Data lives only in that browser, on that device (`localStorage`). Clearing
Safari's website data, switching browsers/devices, or just a new day rolling
over on the dashboard (which is normal — the dashboard always shows *today*;
past days still live in History) can all look like data loss at a glance. To
protect against the real kind — a cleared browser, a lost phone, storage
corruption — use **Backup** on the History tab regularly: **Export Backup**
downloads a JSON file with everything in it; **Import Backup** restores from
one. The app also keeps one automatic generation of backup internally and
self-heals if its storage ever gets corrupted, but that's not a substitute
for an actual exported file living somewhere else (Files app, email to
yourself, iCloud Drive). If you outgrow local storage entirely, the
server-backed version below is the upgrade path.

## Alternative: real backend server (`server.js`)

A Node/Express version with JSON-file storage also lives at the repo root
(`server.js`, `public/`). It's more durable (a real file on disk instead of
browser storage) but needs somewhere to actually run Node — that's easy on a
computer, but awkward on iOS specifically (no simple Termux equivalent). On
Android, [Termux](https://termux.dev) from F-Droid works well:

```bash
pkg install nodejs
```

Then, from this project folder:

```bash
npm install
npm start
```

You'll see:

```
Kenna calorie tracker running at http://localhost:3000
```

Open `http://localhost:3000` in the browser on the same device running the
server.

Entries live in `data/entries.json`, created automatically on first run.
