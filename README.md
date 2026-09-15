# Kenna — Local Calorie Tracker

A lightweight, phone-hostable calorie tracker. No cloud, no account — everything
is stored in a local JSON file on the device running it.

## How it works

Each day you log things **in order**:

1. Current weight
2. Breakfast
3. Snack #1
4. Lunch
5. Snack #2
6. Dinner
7. Snack #3

For every meal/snack you can add multiple foods. Each food asks for:

- Food name (start typing to pick a previously logged food — its calories
  auto-fill)
- % eaten
- Calories

Once submitted, a food's name/calories are remembered so it shows up as a
suggestion next time, instead of retyping it. At the end you review the full
day's totals and save it.

## Running it on your phone

This needs [Node.js](https://nodejs.org) installed on the device. On Android,
the easiest way is [Termux](https://termux.dev) from F-Droid:

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

Open `http://localhost:3000` in your phone's browser. For quick access, use
your browser's "Add to Home Screen" option so it opens like an app.

## Data storage

All entries and your saved-food list live in `data/entries.json` and
`data/foods.json`, created automatically on first run. Back those files up if
you want to preserve your history.
