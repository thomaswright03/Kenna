# Kenna reference

Everything Kenna does, and the rules behind its numbers, in detail. The
[README](README.md) has the short version: what Kenna is, how to install,
run, test and release it.

- [Screens](#screens)
- [How the numbers work](#how-the-numbers-work)
- [Loading and offline](#loading-and-offline)
- [Where your data lives, and backups](#where-your-data-lives-and-backups)
- [Development details](#development-details)

## Screens

- **Today** shows the day's date, your weight and the calories logged so far,
  one row per meal, and Calories and Weight charts (last 30 days, 90 days or
  all time). Tap anywhere on a meal's row to open Log Meal at that meal.
  The weight saves when you leave its box or press Enter, as the line
  under the box says, and also when you leave Today with a weight still in
  the box: the next screen then says "Weight saved: 181.2 lbs", with
  **Undo**. Emptying the weight box clears the day's weight, with **Undo** under the
  box to put it back. Tap **Change day** beside the day's heading and pick
  a date, or tap a day in History, to view or fix a past day; **Back to
  today** returns to the current day. Before anything is logged, a short
  welcome under the heading says what Kenna is. A day with no meals says
  "No meals logged yet today" in place of a total. Once anything is
  logged, a line under the day says how old the last saved backup is
  ("Last backup: 3 days ago", or "No backup saved yet"), with **Back up
  now**.
- **Log Meal** takes one total-calorie number per meal or snack (Breakfast,
  Snack 1, Lunch, Snack 2, Dinner, Snack 3) instead of itemised foods. Each
  value saves as soon as you leave the box or tap another meal, and also
  however you leave the screen with a number still in the box: **Save and
  close** (the screen's one button), the tab bar, the phone's Back gesture, switching to another app, locking
  the phone or closing the page. Leaving within the app, the next screen
  says what was saved ("Lunch saved: 450 cal"), with **Undo** to put back
  what was there before (unless it has been changed again since). A
  number that isn't valid isn't saved: it's kept, and goes back in its box
  with the reason the next time Log Meal opens for that day (the message
  on leaving has **Fix it** to go straight there). The day total updates as you type,
  marked "not saved yet" until the save is done; **Enter** moves
  to the next meal you haven't logged; **Save and close** saves what's in the box, returns to the day you
  were logging and confirms the day's total. **Escape** in the box puts back the saved number. Each saved meal's button shows
  a ✓ and its calories. On the Today screen **Log Meal** is the main way
  in; tapping a meal's row (its name, calories or **Add**/**Edit**) opens
  Log Meal at that meal. A meal removed on the Today screen
  keeps an **Undo** button in its row while you're on that screen; leave
  it within a minute and the next screen offers **Undo** for ten seconds
  more, even if you move on again (a meal logged again since is left as
  it is).
- **History** lists every logged day with its total calories and weight,
  grouped by month under headings with each month's average calories
  (days with meals) and weight, neither counting today. The most recent
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
  different) and yesterday side by side, from zero. When a meal logged
  today has never been logged before (so it has no average), today's bar
  covers only the meals the sentence compares ("Today, these meals") and
  that meal has its own bar ("Snack 2 (no average yet)"), so the gap
  between today's bar and "Usual for these meals" is always the sentence's
  number. When both averages
  show, a line under the bars says the sentence used "Usual for these
  meals", and that "Average day" is a whole day's, so a fair match only
  once today is finished. Each meal's today, yesterday and
  average are one tap further down (**See each meal**). Below that are
  7-day rolling averages of calories and weight. The 7-day calorie average
  leaves today out until the day is over (on the Today screen's Calories
  chart today's running total is a lone hollow marker labelled "so far",
  never joined to the line).
- **Photos** stores progress pictures, filed under the day they were taken
  (with none yet, it says what they're for and offers **Add your first
  photo**):
  **Add Photo** picks the photo first; then, beside a preview, **Which day
  was this photo taken?** asks for its day (it starts at today, and future
  days aren't allowed) and **Save photo** saves it (**Cancel** leaves it
  out). The day can be changed later from the photo viewer. Kenna keeps a
  smaller copy of each photo (at most 1,600 pixels on its longest side,
  re-saved as JPEG where the browser can), and the Photos screen says so:
  the original stays in the phone's photo library. The viewer steps
  through the photos oldest first with **Previous** and **Next**, a swipe or
  the arrow keys. **Compare photos** (on the Photos screen, or **Compare**
  in the viewer) shows two photos side by side, older on the left, with
  each one's date and that day's weight and how far apart they are.
  Deleting a photo asks first, inside the viewer (the photo stays in view;
  **Cancel** or Escape goes back to it), so only one dialog is ever open. A photo in a format the
  browser can't draw (HEIC anywhere but Safari, for example after
  restoring a backup on a laptop) is still kept and backed up as it is;
  adding one says it can't be previewed in this browser, and the grid, the
  viewer and the comparison say "Can't preview in this browser" in its
  place.
- **Settings** (top right, the gear with the word Settings) has the light/dark theme (or follow the system),
  backup export and import, where your data is stored, and the **Problem
  log** (see [Where your data lives](#where-your-data-lives-and-backups)).

On a screen at least 700 pixels wide (a tablet, or a laptop), Today,
Compare, History and Settings use two columns: the day's entry or the
answers on the left, charts and the rest on the right; from about 900
pixels the tabs also move up beside the Kenna name and Settings. History's right column lists every
month's average calories and weight (**Month by month**, in place of Go
to month); tapping a month goes to it.

## How the numbers work

| Rule | Value |
|---|---|
| Calories per meal | whole numbers, 0 to 10,000 ("1,200" is read as 1200) |
| Weight | 50 to 1,000 lbs, at most two decimal places |
| Days that can be logged | today and earlier |
| Averages | leave out today; calories count only days with meals |
| Weights shown together | one decimal (171.0 lbs), or two when one of them was logged with two |
| Calorie averages | whole calories |
| Units and language | pounds, US English only |

- A day counts toward calorie statistics (averages, the "yesterday"
  comparison, charts) only if at least one meal was logged. A day with only a
  weight shows "No meals logged", never "0 cal", and is a gap in the calorie
  chart. Weight statistics use every day that has a weight.
- Every average leaves out today: the all-time averages on Compare (so it
  shows "today vs a typical day") and each month's averages in History,
  for calories and weight alike, so a month reads the same wherever it's
  shown. (The 7-day weight trend line includes today's weigh-in; the
  7-day calorie line doesn't, see Compare in [Screens](#screens).)
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
  read as the whole number. In a backup file
  the day holding such a value is left out of the restore, and the restore
  names it (see Import Backup in [Where your data lives, and backups](#where-your-data-lives-and-backups)). Meals saved by the first version as
  lists of foods still import as their total. The first version saved
  weights exactly as typed; a weight with more than two decimals from then
  is shown, written into backups and read from backups rounded to two.
- A day after today can't be logged, whether picked or typed into the
  address bar. The same goes for filing a photo. A backup's days and photos dated
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
- Weights shown together (one answer on Compare, one month in History,
  two photos compared) all have the same number of decimals, their
  averages and the differences between them included: one ("average 171.0
  lbs · yesterday 171.0 lbs", "1.0 lbs above your average"), or two when
  any weight among them was logged with two ("165.25 lbs today: 0.75 lbs
  below your average"), so a weight is never rounded away. A weight on
  its own (the Weight box, the chart's latest value) shows as entered.
- Weight is in pounds (lbs) and dates and numbers are written the US English
  way ("Thu, Sep 24", "1,200 cal"), whatever the device's language. Pounds and
  US English only are a deliberate limit of scope: there is no kilogram
  setting and no translation.

## Loading and offline

The first visit downloads a handful of files (the app's scripts are built
into two minified files, see [Development details](#development-details)), showing "Loading Kenna…" until
they arrive. With Chromium's "Slow 3G" network emulation Today appears in
under 6 seconds (a browser test checks this).
It works **offline** once opened at least once: the app's files are cached
on the device. When online it loads the latest version; on a weak signal
that hasn't answered within 3 seconds it opens from the cached copy instead,
and the newer files, once they arrive, are used from the next launch.

## Where your data lives, and backups

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

Every such failure is also noted in a **Problem log** on the device (in
`localStorage`, key `kenna:problemLog`): the time, what Kenna was doing
("Save a meal", "Add a photo", "Open history") and the kind of error
("KennaError ← QuotaExceededError"), plus errors in Kenna's own code with
the place in the built script where they happened. It never holds a
logged value, a photo or an error's message, keeps the last 30 events (a
failure repeated straight after itself is counted, not listed again), and
is never sent anywhere. A mistake in what was entered or picked (a file
that isn't a photo, a day that hasn't happened yet) isn't a failure and
isn't noted: the message on screen already explains it.
**Settings → Problem log** shows the latest, each described in plain
words ("The device's storage was full"); **Copy log** copies the whole
list, with the technical names, as text to paste into a
message (or downloads it as a file where the browser won't copy), and
**Clear…** empties it. When the browser's storage is full the event is
still shown and copied for that visit.

On iPhone and iPad, Safari may delete a website's data when it hasn't
been used for about a week, unless the site is on the Home Screen. So when
Kenna runs in a Safari tab there (not opened from the Home Screen), Today
shows a card saying so, with the steps one tap away (**How to add it**:
Share → Add to Home Screen → open Kenna from that icon). Before anything
is logged the card sits under the day, so a first visit starts with the
day itself; once anything is logged it moves above the day and also says
to save a backup first, because the Home Screen app starts with its own,
empty storage. **Not now** hides the card for a
week; it never appears when Kenna is opened from the Home Screen, and
Settings explains the same risk.

That still doesn't protect against clearing Safari's website data, switching
phones or losing the phone, so save a backup file regularly. Once anything is
logged, a line under the day on Today always says how old the last saved
backup is, with **Back up now**, which makes the file and leads straight to
saving it. Once three days have something logged (a weight, a meal or a
photo), a card above the day asks for a backup when none has been saved from
this device yet, or when the last one is more than a week old; **Back up
now** makes one straight away, and **Not now** puts the question off for
three days, while the line under the day keeps showing the backup's age,
marked as overdue. (While the card shows, it says the age itself, so the
line waits until the card is gone.) Today shows at most one of these cards
above the day, so the Weight box stays in view: the Home Screen card first
(it already says to back up), then the backup reminder once that card is
hidden or doesn't apply.

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

## Development details

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

`npm run test:unit` and `npm run test:e2e` run the parts separately
(`test:e2e` rebuilds `docs/build/` first, so the browser tests run the
current sources). The
browser tests include an accessibility check (axe-core, WCAG 2 A and AA)
of every screen in both themes. The
browser tests run every scenario in Chromium with an iPhone-sized screen
(project `phone-app`), and again in WebKit, the engine behind Safari and
iPhone Home Screen apps (project `phone-app-webkit`). Locally the WebKit project is included when
WebKit is installed, and a run without it says so at the start; on CI it
always runs.

`npm run coverage` runs the unit tests and the Chromium browser tests
and prints one coverage table for every source file: `docs/app.js`,
`docs/ui/*.js`, `docs/store-local.js` and the rest. The browser tests record which parts of the built scripts ran and
the source maps turn that back into the source files. The HTML report is
written to `coverage/index.html`; `npm run coverage -- --unit` measures
the unit tests alone.

GitHub Actions (`.github/workflows/test.yml`) runs on every push and pull
request, as two checks: **Tests / test** (lint, type check, unit tests,
Chromium) and **Tests / webkit**. GitHub only blocks merging a failing
change once branch protection is on: in **Settings → Branches**, add a rule
for the published branch (see [Where the app is published](#where-the-app-is-published)), tick *Require status checks to pass
before merging*, and select both checks.

### Where the app is published

Pages is configured in the repository's **Settings → Pages**: *Source:
Deploy from a branch*, branch **`claude/phone-calorie-tracker-gbxsn6`**,
folder **`/docs`**. That branch (also the repository's default branch) is
the published branch: whatever is in its `docs/` folder is the live app.
Other branches, such as `claude/excellence-loop`, are not published until
they are merged into it.
Pages serves the files in `docs/` as they are, which is why the built files
in `docs/build/` are committed (see above).
