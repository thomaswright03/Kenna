# Kenna — Local Calorie Tracker

A lightweight calorie tracker. No cloud account, no sign-up — your data never
leaves your device.

## How it works

The home screen is a **dashboard**: today's date and weight, a running total
of calories logged so far today, and the Calories/Weight trend graphs — all
in one place.

Tapping **Log Food** opens a form to add a food or drink:

- Which meal or snack it was eaten at (Breakfast, Snack 1, Lunch, Snack 2,
  Dinner, or Snack 3 — pick any one, in any order)
- Food name (start typing to pick a previously logged food — its serving
  size auto-fills)
- % Eaten / Servings — `100` = one whole serving, `200` = two servings,
  `50` = half a serving
- Serving size, in calories (e.g. what's on the label for one serving)

Everything saves immediately as you go — there's no separate "save" step.
Once submitted, a food's name/calories are remembered so it shows up as a
suggestion next time, instead of retyping it. A **History** tab lists every
past day with its total calories and weight.

A **Compare** tab shows today's weight, total calories, and calories for each
meal/snack, each against yesterday and against your all-time average for that
stat (averages exclude today itself, so it's "today vs your typical day," not
today diluting its own baseline).

## Using it on your phone (recommended — `docs/`)

The `docs/` folder is a self-contained, static version of the app: no server,
no install. It saves everything in the browser's local storage on your
device.

1. In this repo on GitHub: **Settings → Pages → Source: Deploy from a
   branch**, pick this branch and the `/docs` folder, then Save. GitHub gives
   you a URL like `https://<your-username>.github.io/Kenna/`.
2. Open that URL in Safari on your phone.
3. Tap the Share icon → **Add to Home Screen**. It now opens full-screen like
   a normal app.

Data lives only in that browser, on that device (`localStorage`). Clearing
Safari's website data, or switching browsers/devices, means starting fresh —
there's no sync or backup. If you outgrow that limitation later, the
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

Entries and the saved-food list live in `data/entries.json` and
`data/foods.json`, created automatically on first run.
