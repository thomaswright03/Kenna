# iPhone release checklist

The automated tests run the app in Chromium and WebKit, but the share
sheet, Home Screen install and iPhone storage only exist on a real iPhone.
Go through this list on an iPhone before merging a change into the
published branch (`claude/phone-calorie-tracker-gbxsn6`), and again on the
live site once Pages has deployed it.

Use a copy of the app at its own address (the steps below do), never the
live Kenna you log with: each web address keeps its own data, so nothing
here touches your real days or photos.

## Before merging

1. `npm test` passes, and the GitHub checks **Tests / test** and
   **Tests / webkit** are green on the pull request.
2. On a computer on the same Wi-Fi as the iPhone, put the live version
   beside this one and serve it:
   `git fetch origin && git worktree add ../kenna-live origin/claude/phone-calorie-tracker-gbxsn6`,
   then in `../kenna-live` run `node scripts/serve-docs.js`. Note the
   computer's network address (for example 192.168.1.23).
3. On the iPhone, open `http://<that address>:8080` in Safari.
4. Tap Share → **Add to Home Screen** → **Add**, and open Kenna from the new
   icon. The "Add Kenna to your Home Screen" card is not shown there.
   With this live version, log a weight and two meals for today, and a
   meal for yesterday (open yesterday from Today's day control). Close
   the app.
5. Upgrade the copy to this change: on the computer stop that server
   (Ctrl+C) and run `npm run serve:docs` in this branch's folder (the same
   address and port, so the phone keeps the same data). Open Kenna from
   its icon while online: it loads the new version. The days logged in
   step 4 are all there with the same numbers (Today, History). Change
   one of today's meals, close the app, open it again: the change and
   every other number are still there. (Afterwards, on the computer:
   `git worktree remove ../kenna-live`.)
6. Log a meal: **Log Meal**, type a number, **Save and close**. Today shows
   "Saved for Today" and the new total.
7. Log a weight and check it in History and on Compare. In History, tap
   **Show earlier months**, open a day further down and swipe back: History
   shows the same months, with that day where it was.
8. On Log Meal, type 4000 for Breakfast and tap Return: Kenna asks "Keep
   4,000 cal for breakfast?". Tap **Change it**, then the Today tab: the
   Breakfast row shows "4,000 cal not saved yet" and History marks the day.
   Tap the row, then **Keep it**: the row then shows 4,000 cal.
9. Add a progress photo from the photo library (a HEIC one if you have it),
   confirm its day and tap **Save photo**.
   It appears on the Photos screen and opens in the viewer. Delete it in the
   viewer and tap **Undo** in the message: it comes back on the same day.
10. Settings → **Export Backup** → **Save or share…** → **Save to Files**.
    Settings then says "Backup shared" and when.
11. Delete the photo and change the meal, then Settings → **Import Backup**
    and pick the file just saved. The question says 1 day will be replaced;
    after **Restore**, the meal and the photo come back. **Undo restore**
    brings back the changed meal and removes the photo again. Import the
    file again and **Restore**, then import it once more: this time Kenna
    says there's nothing to restore, with only **Close**.
12. Open Photos with two photos added, step between them with a swipe,
    and compare them side by side (**Compare photos**).
13. Delete the test copy from the Home Screen (touch and hold → Remove App).

Finish every step, and record it below, before merging the pull request.

## After Pages deploys

1. Open the live app from its Home Screen icon while online, then close it.
2. Turn on Airplane Mode and open it again: it opens and shows your data.
3. If anything fails, roll back as the README describes.

## Record

Add a row here, in the same pull request as the change, each time the
list is gone through: the date, the iPhone model and iOS version, the
commit tested (its short hash), which part (Before merging or After
deploy) and the result of every step by number, each as "3 passed" or
"3 failed: what happened and what was done about it", for example
`1 passed; 2 passed; … 13 passed`. "All passed" isn't enough.

For "Before merging", test the pull request's last commit, then add the
row in a commit of its own that changes nothing but this file, and push
it. The **Tests / release-record** check on the pull request
(`scripts/check-release-record.js`) fails until there is such a row: one
naming a commit on the branch after which only this file changed, with
every step of "Before merging" given by number. A change pushed after
the run makes it fail again, because what would be merged is no longer
what was tested.

| Date | iPhone, iOS | Commit | Part | Result |
|---|---|---|---|---|
| 2026-09-24 | iPhone 14, iOS 18.7.2 | 64d7124 | Before merging | Steps 1–11 passed. In step 6, Show earlier months wasn't tried: the test copy held one day, so the button is rightly not shown. The pull request was merged while steps 9–11 were under way. |
| 2026-09-24 | iPhone 14, iOS 18.7.2 | 64d7124 | After deploy | All passed: opened from the Home Screen online, then in Airplane Mode. |
| 2026-09-24 | iPhone 14, iOS 18.7.2 | 7879d9c | Before merging | All passed, as reported by the owner (steps not itemised). |
| 2026-09-24 | iPhone 14, iOS 18.7.2 | 1256a23 (live) | After deploy | All passed on the live app, as reported by the owner. |
